// The single model provider function. Every model_1 step (extract / generate) goes through callModel().
// Provider: the locally installed Claude Code CLI (`claude -p --output-format json`), started without CLAUDECODE.
// To swap providers, replace the body of callModel(); callers only depend on its signature.
import { spawn } from 'node:child_process';
import os from 'node:os';

export interface ModelCall {
  /** design actor + operation, for logs, e.g. "model_1 extract" */
  role: string;
  system: string;
  prompt: string;
  /** JSON Schema for the structured output */
  schema: object;
  timeoutMs?: number;
}

const MODEL = process.env.SYSTEMX_MODEL ?? 'haiku';
const MAX_CONCURRENT = Number(process.env.SYSTEMX_MAX_CONCURRENT ?? 4);
let running = 0;
const queue: (() => void)[] = [];
const acquire = () =>
  new Promise<void>((res) => {
    if (running < MAX_CONCURRENT) {
      running++;
      res();
    } else queue.push(() => { running++; res(); });
  });
const release = () => {
  running--;
  queue.shift()?.();
};

export const modelName = () => MODEL;

export async function callModel<T>({ role, system, prompt, schema, timeoutMs = 180_000 }: ModelCall): Promise<T> {
  await acquire();
  const t0 = Date.now();
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = [
      '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(schema),
      '--system-prompt', system,
      '--tools', '',
      '--no-session-persistence',
      '--model', MODEL,
    ];
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('claude', args, { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${role}: model call timed out`)); }, timeoutMs);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !out) reject(new Error(`${role}: claude exited ${code}: ${err.slice(0, 500)}`));
        else resolve(out);
      });
      child.stdin.end(prompt);
    });
    const envelope = JSON.parse(stdout);
    if (envelope.is_error) throw new Error(`${role}: ${envelope.result ?? 'model error'}`);
    let data: unknown = envelope.structured_output;
    if (data === undefined || data === null) {
      const text = String(envelope.result ?? '');
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`${role}: no JSON in model output`);
      data = JSON.parse(m[0]);
    }
    console.log(`[${role}] ${Date.now() - t0} ms`);
    return data as T;
  } finally {
    release();
  }
}
