// The single swap point for generative model calls (model_2, model_6, model_7).
// Current provider: the locally installed Claude Code CLI, run as `claude -p --output-format json`.
import { spawn } from 'node:child_process';
import type { z } from 'zod';

export interface ModelCall<T> {
  role: string; // e.g. 'model_2 translate', used for logging
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  jsonSchema: object; // JSON Schema handed to the provider for structured output
  imagePaths?: string[]; // files the model may read (vision)
  retries?: number;
}

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL; // optional override, e.g. 'sonnet'
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 180_000);

function runClaude(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(CLAUDE_BIN, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(input);
  });
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in model output');
  return JSON.parse(body.slice(start, Math.max(body.lastIndexOf('}'), body.lastIndexOf(']')) + 1));
}

/** Calls the generative model and returns validated, typed output. Retries on invalid output. */
export async function callModel<T>(call: ModelCall<T>): Promise<T> {
  const retries = call.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const args = [
      '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(call.jsonSchema),
      '--append-system-prompt', call.system,
    ];
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
    if (call.imagePaths?.length) args.push('--tools', 'Read', '--allowedTools', 'Read');
    else args.push('--tools', '');
    const prompt =
      call.prompt +
      (call.imagePaths?.length ? `\n\nRead and look at these image files before answering: ${call.imagePaths.join(', ')}` : '') +
      (attempt > 0 ? `\n\nYour previous answer was invalid (${String(lastError).slice(0, 300)}). Answer again with valid JSON matching the schema.` : '');
    const t0 = Date.now();
    try {
      const raw = await runClaude(args, prompt);
      const envelope = JSON.parse(raw);
      if (envelope.is_error) throw new Error(`model error: ${envelope.result}`);
      const data = envelope.structured_output ?? extractJson(String(envelope.result ?? ''));
      const parsed = call.schema.parse(data);
      console.log(`[${call.role}] ok in ${Date.now() - t0} ms`);
      return parsed;
    } catch (e) {
      lastError = e;
      console.warn(`[${call.role}] attempt ${attempt + 1} failed:`, String(e).slice(0, 300));
    }
  }
  throw new Error(`${call.role} failed: ${String(lastError)}`);
}
