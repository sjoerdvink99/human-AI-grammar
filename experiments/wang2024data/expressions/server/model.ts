import { spawn } from 'node:child_process';

/**
 * The single model provider entry point. Every [model ...] step goes through
 * callModel(), so swapping Claude Code CLI for an API client only changes this file.
 *
 * Current provider: the locally installed Claude Code CLI in print mode,
 * `claude -p --output-format json`, started with CLAUDECODE removed from env.
 */
export interface ModelCall {
  system: string;
  prompt: string;
  timeoutMs?: number;
}

export async function callModel({ system, prompt, timeoutMs = 120_000 }: ModelCall): Promise<string> {
  if (process.env.MOCK_MODEL === '1') return mockModel(prompt);

  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--system-prompt', system,
  ];
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`model call timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) return reject(new Error(`model error: ${parsed.result ?? parsed.subtype}`));
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error(`claude exited with ${code}: ${stderr || stdout}`.slice(0, 2000)));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Deterministic stand-in used by tests and when MOCK_MODEL=1. */
function mockModel(prompt: string): string {
  const m = prompt.match(/Source columns: (.*)/);
  const cols: string[] = m ? JSON.parse(m[1]) : [];
  const expr = cols.length ? cols.map((c) => `Number(row[${JSON.stringify(c)}])`).join(' + ') : '0';
  return '```javascript\nfunction derive(row, index, table) {\n  return ' + expr + ';\n}\n```';
}
