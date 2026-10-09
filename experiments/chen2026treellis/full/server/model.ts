// The single model-provider boundary. Every [model …] step in the design goes through callModel().
// Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
// To swap providers, replace the body of callModel() — callers only depend on its signature.

import { spawn } from 'node:child_process';
import os from 'node:os';

export interface ModelRequest {
  /** Role-specific system prompt (one per model operation). */
  system: string;
  /** User message built only from the representations in the preceding state. */
  user: string;
  /** Optional model id override (e.g. via MODEL env). */
  model?: string;
  timeoutMs?: number;
}

export interface ModelResponse {
  text: string;
  durationMs: number;
  costUsd?: number;
}

export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  const env = { ...process.env };
  delete env.CLAUDECODE; // the CLI refuses/behaves differently when nested inside a Claude Code session
  const args = [
    '-p',
    '--output-format',
    'json',
    '--system-prompt',
    req.system,
    '--tools',
    '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--strict-mcp-config',
  ];
  const model = req.model ?? process.env.MODEL;
  if (model) args.push('--model', model);

  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Model call timed out'));
    }, req.timeoutMs ?? 240_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start claude CLI: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed: { result?: string; is_error?: boolean; total_cost_usd?: number } | null = null;
      try {
        parsed = JSON.parse(out);
      } catch {
        /* handled below */
      }
      if (!parsed || code !== 0 || parsed.is_error || typeof parsed.result !== 'string') {
        reject(new Error(`claude CLI failed (exit ${code}): ${(parsed?.result ?? err ?? out).toString().slice(0, 500)}`));
        return;
      }
      resolve({ text: parsed.result, durationMs: Date.now() - started, costUsd: parsed.total_cost_usd });
    });
    // prompt via stdin avoids argv length limits for large scenes
    child.stdin.end(req.user);
  });
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences and stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model reply contained no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}
