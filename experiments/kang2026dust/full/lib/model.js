// The single swap point for the language model ("model" actor in the design).
// Default provider: the locally installed Claude Code CLI.
import { spawn } from 'node:child_process';

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180_000);

/** @param {string} prompt @returns {Promise<string>} */
function claudeCliProvider(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = ['-p', '--output-format', 'json'];
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err || out}`.slice(0, 500)));
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`claude error: ${parsed.result}`));
        resolve(String(parsed.result ?? ''));
      } catch (e) {
        reject(new Error(`Could not parse claude output: ${out.slice(0, 300)}`));
      }
    });
    // Prompt goes through stdin so long highlights never hit argv limits.
    child.stdin.end(prompt);
  });
}

let provider = claudeCliProvider;

/** Replace the model provider (used by tests, or to swap to an API client). */
export function setModelProvider(fn) { provider = fn || claudeCliProvider; }

/** Call the model with a prompt and return its text. */
export function callModel(prompt) { return provider(prompt); }

/** Call the model and parse a JSON object from its reply. */
export async function callModelJson(prompt) {
  const text = await callModel(prompt);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}
