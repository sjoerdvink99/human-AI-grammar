// The single function through which every model step runs.
// Provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
// Swap the body of `callModel` to change the provider; all model adapters go through it.
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface ModelCall {
  /** distinct model roles (model_1..model_4) get distinct system prompts */
  role: 'model_1' | 'model_2' | 'model_3' | 'model_4';
  system: string;
  prompt: string;
  /** absolute paths of PNG images the model must look at */
  images?: string[];
  /** JSON schema of the expected output; the result is validated against required keys */
  schema: Record<string, unknown>;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_MODEL = process.env.SYSTEMX_MODEL || 'sonnet';
const MAX_CONCURRENT = Number(process.env.SYSTEMX_MAX_CONCURRENT || 4);
let active = 0;
const queue: (() => void)[] = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((r) => queue.push(r));
  active++;
}
function release() {
  active--;
  queue.shift()?.();
}

export async function callModel<T>(call: ModelCall, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await acquire();
      try {
        return await runClaude<T>(call);
      } finally {
        release();
      }
    } catch (e) {
      lastErr = e;
      console.warn(`[callModel ${call.role}] attempt ${i + 1} failed:`, (e as Error).message);
    }
  }
  throw lastErr;
}

function runClaude<T>(call: ModelCall): Promise<T> {
  const images = call.images ?? [];
  const imageText = images.length
    ? `\n\nFirst use the Read tool to view ${images.length === 1 ? 'this image' : 'these images, in order'}:\n${images.map((p, i) => `${i + 1}. ${p}`).join('\n')}\nDo not use any other tool.`
    : '';
  const args = [
    '-p',
    call.prompt + imageText,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(call.schema),
    '--system-prompt',
    call.system,
    '--model',
    call.model ?? DEFAULT_MODEL,
    '--no-session-persistence',
  ];
  if (images.length) {
    args.push('--allowedTools', 'Read');
    const dirs = [...new Set(images.map((p) => path.dirname(p)))];
    args.push('--add-dir', ...dirs);
  } else {
    args.push('--disallowedTools', 'Bash Edit Write Read WebFetch WebSearch Glob Grep');
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude CLI timed out (${call.role})`));
    }, call.timeoutMs ?? 240_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(out);
        if (env.is_error) throw new Error(`claude error: ${env.result ?? env.subtype}`);
        let value = env.structured_output;
        if (value === undefined || value === null) value = extractJson(env.result ?? '');
        validateRequired(value, call.schema);
        resolve(value as T);
      } catch (e) {
        reject(new Error(`${(e as Error).message} (exit ${code}) ${err.slice(0, 300)} ${out.slice(0, 300)}`));
      }
    });
  });
}

function extractJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = m ? m[1] : text;
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in model output');
  return JSON.parse(s.slice(start));
}

function validateRequired(value: any, schema: any) {
  if (schema?.type === 'object') {
    if (typeof value !== 'object' || value === null) throw new Error('model output is not an object');
    for (const k of schema.required ?? []) {
      if (!(k in value)) throw new Error(`model output missing "${k}"`);
    }
  }
}
