// The single model-provider function. Swap the body to change provider.
import { spawn } from 'node:child_process';
import os from 'node:os';

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 240_000);

export interface ModelCall {
  system: string;
  user: string;
}

/** Calls the locally installed Claude Code CLI in print mode and returns the text result. */
export async function callModel({ system, user }: ModelCall): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ['-p', '--output-format', 'json', '--append-system-prompt', system];
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);

  return new Promise((resolve, reject) => {
    // Run outside the project so the CLI does not pick up repository context.
    const child = spawn('claude', args, { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Model call timed out.'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out);
        if (json.is_error) return reject(new Error(`Model error: ${json.result ?? json.subtype}`));
        resolve(String(json.result ?? ''));
      } catch {
        reject(new Error(`Claude CLI exited with ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.write(user);
    child.stdin.end();
  });
}
