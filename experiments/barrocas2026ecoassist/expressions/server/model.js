// The single provider boundary for every model step (model_1 generate, model_2 modify).
// Swap the body of callModel() to use another provider; callers only see text in, text out.
import { spawn } from 'node:child_process';

export const MODEL_CHOICES = ['haiku', 'sonnet', 'opus'];

/**
 * @param {object} opts
 * @param {string} opts.prompt   user prompt
 * @param {string} [opts.system] system prompt
 * @param {string} [opts.model]  one of MODEL_CHOICES (or any id the CLI accepts)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{text: string, costUsd?: number, model?: string}>}
 */
export function callModel({ prompt, system, model = 'sonnet', timeoutMs = 600_000 }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = ['-p', '--output-format', 'json', '--model', model, '--tools', ''];
    if (system) args.push('--system-prompt', system);
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, {
      env,
      cwd: process.env.MODEL_CWD || '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
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
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return reject(new Error(`model CLI exited ${code}: ${(err || out).slice(0, 500)}`));
      }
      if (parsed.is_error || typeof parsed.result !== 'string') {
        return reject(new Error(`model error: ${String(parsed.result || parsed.subtype || err).slice(0, 500)}`));
      }
      resolve({ text: parsed.result, costUsd: parsed.total_cost_usd, model });
    });
    child.stdin.end(prompt);
  });
}

/** Pull one HTML document out of a model reply (fenced or bare) and validate it. */
export function extractHtml(text) {
  const fence = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  let html = (fence ? fence[1] : text).trim();
  const start = html.search(/<!doctype html|<html/i);
  if (start > 0) html = html.slice(start);
  const end = html.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) html = html.slice(0, end + 7);
  if (!/<(html|body|head|div|main|section)\b/i.test(html)) {
    throw new Error('model output did not contain an HTML document');
  }
  return html + '\n';
}
