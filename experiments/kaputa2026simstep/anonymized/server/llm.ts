// The single model-provider function. Swap the body to use a different provider.
// Current provider: the locally installed Claude Code CLI in print mode with structured output.
import { spawn } from 'node:child_process';

export interface ModelCall {
  system: string;
  prompt: string;
  schema: object; // JSON Schema of the expected output
  timeoutMs?: number;
}

export async function callModel<T = unknown>({ system, prompt, schema, timeoutMs = 240_000 }: ModelCall): Promise<T> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', '',
    '--system-prompt', system,
    '--json-schema', JSON.stringify(schema),
  ];
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`model call timed out after ${timeoutMs} ms`));
    }, timeoutMs);
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
    child.stdin.end(prompt);
  });

  let envelope: any;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (envelope.is_error) throw new Error(`model error: ${String(envelope.result).slice(0, 300)}`);
  if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
    return envelope.structured_output as T;
  }
  // Fallback: parse JSON from the text result.
  const text: string = String(envelope.result ?? '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('model returned no JSON');
  return JSON.parse(match[0]) as T;
}
