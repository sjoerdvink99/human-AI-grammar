// The single model provider boundary. Every model_1 step (and the model parts of
// model_2 / model_3) goes through callModel(). Swap this file to change providers.
import { spawn } from 'node:child_process';

export interface ModelCall {
  /** Which design actor/operation this call implements, e.g. "model_1 extract". */
  step: string;
  system: string;
  prompt: string;
  /** JSON Schema for structured output. */
  schema: Record<string, unknown>;
  timeoutMs?: number;
}

const MAX_CONCURRENT = Number(process.env.MODEL_CONCURRENCY ?? 4);
let active = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise<void>((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

/** Run the locally installed Claude Code CLI and return its structured output. */
export async function callModel<T>(call: ModelCall): Promise<T> {
  await acquire();
  try {
    return await runClaude<T>(call);
  } finally {
    release();
  }
}

function runClaude<T>({ step, system, prompt, schema, timeoutMs = 5 * 60_000 }: ModelCall): Promise<T> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--system-prompt', system,
    '--tools', '',
    '--no-session-persistence',
  ];
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${step}: model timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      console.log(`[model] ${step} finished in ${((Date.now() - started) / 1000).toFixed(1)}s (exit ${code})`);
      try {
        const envelope = JSON.parse(out);
        if (envelope.is_error) return reject(new Error(`${step}: ${envelope.result ?? 'model error'}`));
        if (envelope.structured_output !== undefined) return resolve(envelope.structured_output as T);
        // Fallback: parse JSON from the text result.
        const text: string = envelope.result ?? '';
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return reject(new Error(`${step}: no JSON in model output`));
        resolve(JSON.parse(m[0]) as T);
      } catch (e) {
        reject(new Error(`${step}: could not parse CLI output (exit ${code}): ${(err || out).slice(0, 400)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Call the model, validate, and retry once with the validation error appended. */
export async function callModelValidated<T>(call: ModelCall, validate: (v: T) => string | null, attempts = 2): Promise<T> {
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    const prompt = lastError
      ? `${call.prompt}\n\nYour previous answer was rejected: ${lastError}. Fix this.`
      : call.prompt;
    const value = await callModel<T>({ ...call, prompt });
    const problem = validate(value);
    if (!problem) return value;
    lastError = problem;
    console.warn(`[model] ${call.step} validation failed: ${problem}`);
  }
  throw new Error(`${call.step}: output failed validation (${lastError})`);
}
