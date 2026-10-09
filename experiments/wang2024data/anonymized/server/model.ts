import { spawn } from 'node:child_process';

/**
 * The single model-provider function. Every model step in the app goes through here.
 * Implementation: the locally installed Claude Code CLI in print mode with JSON output,
 * no built-in tools, started without the CLAUDECODE environment variable.
 * Swap this function to use another provider.
 */
export async function callModel(prompt: string, opts: { system?: string; timeoutMs?: number } = {}): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ['-p', '--output-format', 'json', '--tools', ''];
  if (opts.system) args.push('--system-prompt', opts.system);
  if (process.env.MODEL) args.push('--model', process.env.MODEL);

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('model call timed out'));
    }, opts.timeoutMs ?? 180_000);
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
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Pull the derive function out of a model response. */
export function extractCode(response: string): string | null {
  const block = response.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
  const code = (block ? block[1] : response).trim();
  return /function\s+derive\s*\(/.test(code) ? code : null;
}
