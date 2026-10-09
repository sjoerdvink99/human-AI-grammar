// The single model-provider seam. Every [model …] step goes through callModel().
// Current provider: the locally installed Claude Code CLI (no API key needed).
import { spawn } from 'node:child_process';

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

/**
 * Call the model with a prompt and return its text output.
 * @param {string} prompt
 * @param {{system?: string}} [opts]
 * @returns {Promise<string>}
 */
export function callModel(prompt, opts = {}) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ['-p', '--output-format', 'json'];
  if (opts.system) args.push('--append-system-prompt', opts.system);
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err || out}`.slice(0, 500)));
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`Model error: ${parsed.result}`));
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error('Could not parse CLI output'));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Ask for JSON and validate it; retries once on invalid output. */
export async function callModelJSON(prompt, validate, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callModel(
      prompt + (attempt ? '\n\nYour previous answer was not valid. Respond with ONLY the JSON object.' : ''),
      opts,
    );
    try {
      const json = extractJSON(text);
      return validate(json);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Invalid model output: ${lastErr?.message}`);
}

export function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object found');
  return JSON.parse(body.slice(start, end + 1));
}
