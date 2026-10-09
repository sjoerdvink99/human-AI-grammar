/**
 * The single provider boundary. Every model step (model_1 … model_5) calls
 * `callModel`. To swap providers, replace the body of this function.
 *
 * Current provider: the locally installed Claude Code CLI, run as
 *   claude -p --output-format json [--json-schema …] [--system-prompt …]
 * with the CLAUDECODE environment variable removed.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';

export type ModelRole = 'model_1' | 'model_2' | 'model_3' | 'model_4' | 'model_5';

export interface CallModelOptions {
  /** role-specific system prompt (distinct configuration per model role) */
  system: string;
  /** user prompt, built only from the representations of the preceding state */
  prompt: string;
  /** JSON schema for structured output */
  schema?: object;
  /** image files the model may look at (vision roles) */
  imageFiles?: string[];
  /** directory containing imageFiles */
  imageDir?: string;
  timeoutMs?: number;
}

export interface ModelResult<T> {
  text: string;
  data: T | undefined;
}

const MAX_CONCURRENT = Number(process.env.MODEL_CONCURRENCY ?? 4);
let active = 0;
const queue: Array<() => void> = [];
async function acquire() {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise<void>((res) => queue.push(res));
  active++;
}
function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

export async function callModel<T = unknown>(role: ModelRole, opts: CallModelOptions): Promise<ModelResult<T>> {
  await acquire();
  try {
    return await runClaude<T>(role, opts);
  } finally {
    release();
  }
}

function runClaude<T>(role: ModelRole, opts: CallModelOptions): Promise<ModelResult<T>> {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--system-prompt', opts.system];
  const model = process.env[role.toUpperCase()] ?? process.env.MODEL;
  if (model) args.push('--model', model);
  if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema));
  if (opts.imageFiles?.length && opts.imageDir) {
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', opts.imageDir);
  } else {
    args.push('--tools', '');
  }
  let prompt = opts.prompt;
  if (opts.imageFiles?.length) {
    prompt += `\n\nImage file(s) to inspect with the Read tool:\n${opts.imageFiles.join('\n')}`;
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, cwd: opts.imageDir ?? os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${role} timed out`));
    }, opts.timeoutMs ?? 180_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed: { result?: string; structured_output?: T; is_error?: boolean };
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new Error(`${role}: CLI exited ${code}: ${err || out}`.slice(0, 800)));
      }
      if (parsed.is_error) return reject(new Error(`${role}: ${parsed.result ?? 'model error'}`));
      const text = parsed.result ?? '';
      let data = parsed.structured_output;
      if (data === undefined && opts.schema) data = extractJson<T>(text);
      resolve({ text, data });
    });
    child.stdin.end(prompt);
  });
}

/** Pull the first JSON object out of free text (handles ``` fences). */
export function extractJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
