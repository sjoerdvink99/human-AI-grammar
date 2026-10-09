// The single provider boundary. Every model step in the design (model_1 and
// model_2) goes through callModel(). To swap providers, reimplement this file.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ModelRole = 'model_1' | 'model_2';

export interface ModelCall {
  role: ModelRole;
  system: string;
  prompt: string;
  /** Optional JSON schema; the CLI then returns validated structured output. */
  jsonSchema?: object;
  timeoutMs?: number;
}

export interface ModelResult {
  text: string;
  structured?: unknown;
  costUsd?: number;
}

// Separate configurations per model role (overridable by env).
const ROLE_MODEL: Record<ModelRole, string | undefined> = {
  model_1: process.env.MODEL_1 || undefined, // "image" model (emulated: SVG)
  model_2: process.env.MODEL_2 || undefined, // language model
};

const scratch = mkdtempSync(join(tmpdir(), 'systemx-'));

export function callModel(call: ModelCall): Promise<ModelResult> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--system-prompt', call.system,
  ];
  const model = ROLE_MODEL[call.role];
  if (model) args.push('--model', model);
  if (call.jsonSchema) args.push('--json-schema', JSON.stringify(call.jsonSchema));

  const env = { ...process.env };
  delete env.CLAUDECODE;

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('model call timed out'));
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
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(String(j.result || 'model error')));
        resolve({ text: String(j.result ?? ''), structured: j.structured_output, costUsd: j.total_cost_usd });
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.end(call.prompt);
  });
}

/** Pull a JSON value out of model text (structured_output preferred). */
export function extractJson<T>(r: ModelResult): T {
  if (r.structured !== undefined && r.structured !== null) return r.structured as T;
  const t = r.text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : t;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('model returned no JSON');
  return JSON.parse(body.slice(start)) as T;
}
