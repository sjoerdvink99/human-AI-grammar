/**
 * The single model-provider function. Every [model …] step goes through callModel().
 * Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`),
 * spawned with the CLAUDECODE environment variable removed. Swap the body to change provider.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';

export interface ModelCall {
  /** operation name, for logging */
  op: string;
  system: string;
  prompt: string;
  /** JSON schema of the structured output */
  schema: object;
  tier: 'author' | 'play';
}

const MODELS = {
  author: process.env.AUTHOR_MODEL || 'sonnet',
  play: process.env.PLAY_MODEL || 'haiku',
};
const CLI = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

export async function callModel<T>(call: ModelCall): Promise<T> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    '-p', call.prompt,
    '--output-format', 'json',
    '--model', MODELS[call.tier],
    '--system-prompt', call.system,
    '--json-schema', JSON.stringify(call.schema),
    '--tools', '',
    '--no-session-persistence',
  ];
  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    // run from the temp dir so no project CLAUDE.md or settings leak into the prompt
    const child = spawn(CLI, args, { env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${call.op}: model timed out`)); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`${call.op}: claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
  });
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { throw new Error(`${call.op}: CLI output was not JSON`); }
  if (parsed.is_error) throw new Error(`${call.op}: ${parsed.result ?? parsed.subtype}`);
  let data = parsed.structured_output;
  if (data == null && typeof parsed.result === 'string') {
    const m = parsed.result.match(/\{[\s\S]*\}/);
    if (m) data = JSON.parse(m[0]);
  }
  if (data == null) throw new Error(`${call.op}: no structured output`);
  console.log(`[model] ${call.op} (${MODELS[call.tier]}) ${Date.now() - started}ms`);
  return data as T;
}
