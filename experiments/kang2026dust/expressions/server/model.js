// The single model-provider function. Swap this file to change provider.
import { spawn } from 'node:child_process';

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 120000);

/** Run the local Claude Code CLI with a prompt and return its text result. */
export function callModelText(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(process.env.CLAUDE_BIN || 'claude', ['-p', '--output-format', 'json'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Model call timed out'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err || out}`.slice(0, 500)));
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`Model error: ${parsed.result}`));
        resolve(String(parsed.result ?? ''));
      } catch (e) {
        reject(new Error('Could not parse CLI output: ' + out.slice(0, 300)));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Extract the first JSON object from model text. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Call the model and return a validated JSON object.
 * `validate(obj)` must return the cleaned value or throw. Retries once on invalid output.
 */
export async function callModel(prompt, validate, { attempts = 2 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await callModelText(
        prompt + (i > 0 ? '\n\nYour previous answer was not valid. Reply with ONLY the JSON object.' : '')
      );
      return validate(extractJson(text));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
