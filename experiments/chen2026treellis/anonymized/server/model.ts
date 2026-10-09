// The single provider boundary. Every model step goes through callModel().
// Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ModelCall {
  system: string;
  prompt: string;
  signal?: AbortSignal;
}

// Run in an empty directory so no project files or CLAUDE.md leak into the context.
const WORK_DIR = mkdtempSync(join(tmpdir(), 'system-x-model-'));
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 180_000);

export function callModel({ system, prompt, signal }: ModelCall): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = ['-p', '--output-format', 'json', '--tools', '', '--system-prompt', system];
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd: WORK_DIR, env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`could not start claude CLI: ${e.message}`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('cancelled'));
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error || typeof parsed.result !== 'string')
          return reject(new Error(`model error: ${parsed.result ?? parsed.subtype ?? 'unknown'}`));
        resolve(parsed.result);
      } catch {
        reject(new Error(`claude CLI exited with ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
