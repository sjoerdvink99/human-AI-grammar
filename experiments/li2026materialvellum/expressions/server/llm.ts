/**
 * The single provider function for every model step in the design.
 * Swap the body of `callModel` to change provider (e.g. the Anthropic API or a diffusion server).
 *
 * Current provider: the locally installed Claude Code CLI, run as
 *   claude -p --output-format json --json-schema <schema> --tools "" --system-prompt <system>
 * with the CLAUDECODE environment variable removed so it can be started from inside Claude Code.
 */
import { spawn } from 'node:child_process';
import type { ZodType } from 'zod';

export interface ModelCall<T> {
  /** which model role in the design is being called: "model_1" or "model_2" */
  role: 'model_1' | 'model_2';
  system: string;
  prompt: string;
  /** JSON Schema handed to the provider for structured output */
  jsonSchema: object;
  /** zod validator applied to whatever the provider returns */
  validate: ZodType<T>;
  timeoutMs?: number;
}

const MODEL_FOR_ROLE: Record<ModelCall<unknown>['role'], string | undefined> = {
  model_1: process.env.MODEL_1,
  model_2: process.env.MODEL_2,
};

export async function callModel<T>(call: ModelCall<T>): Promise<T> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', '',
    '--system-prompt', call.system,
    '--json-schema', JSON.stringify(call.jsonSchema),
  ];
  const model = MODEL_FOR_ROLE[call.role];
  if (model) args.push('--model', model);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${call.role} timed out after ${(call.timeoutMs ?? 300_000) / 1000}s`));
    }, call.timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(call.prompt);
  });

  let envelope: { is_error?: boolean; result?: string; structured_output?: unknown };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (envelope.is_error) throw new Error(`Model error: ${String(envelope.result).slice(0, 500)}`);

  let payload = envelope.structured_output;
  if (payload === undefined && typeof envelope.result === 'string') {
    const m = envelope.result.match(/\{[\s\S]*\}/);
    if (m) payload = JSON.parse(m[0]);
  }
  const parsed = call.validate.safeParse(payload);
  if (!parsed.success) throw new Error(`Model output failed validation: ${parsed.error.message.slice(0, 500)}`);
  return parsed.data;
}
