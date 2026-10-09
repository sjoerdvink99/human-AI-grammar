// The single provider boundary for every model step. Swap the body of
// callModel() to use a different provider (e.g. the Anthropic API).
import { spawn } from 'node:child_process';

export interface ModelRequest {
  system: string;
  prompt: string;
  /** optional model alias passed to the CLI */
  model?: string;
  timeoutMs?: number;
}

export async function callModel(req: ModelRequest): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    '-p',
    '--output-format',
    'json',
    '--tools',
    '',
    '--no-session-persistence',
    '--system-prompt',
    req.system,
  ];
  const model = req.model ?? process.env.SYSTEM_X_MODEL;
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('model call timed out'));
    }, req.timeoutMs ?? 180_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(String(parsed.result ?? 'model error')));
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error(`claude exited with ${code}: ${err || out}`.slice(0, 2000)));
      }
    });
    // Prompt via stdin avoids argument-length limits.
    child.stdin.write(req.prompt);
    child.stdin.end();
  });
}
