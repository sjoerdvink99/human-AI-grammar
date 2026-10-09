// The single model provider boundary. Every model step (model_1..model_4) calls callModel().
// To swap providers, replace the body of callModel; callers only rely on {system, prompt} -> parsed JSON.
import { spawn } from 'node:child_process';

const MODEL = process.env.SYSTEMX_MODEL || 'sonnet';
const TIMEOUT_MS = Number(process.env.SYSTEMX_TIMEOUT_MS || 180000);

/** Run the local Claude Code CLI headless and return the raw text result. */
function runClaudeCli(fullPrompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = ['-p', '--output-format', 'json', '--model', MODEL, '--tools', ''];
    const child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const envelope = JSON.parse(out);
        if (envelope.is_error) return reject(new Error('model error: ' + envelope.result));
        resolve(String(envelope.result ?? ''));
      } catch {
        reject(new Error(`claude CLI failed (exit ${code}): ${err || out}`.slice(0, 800)));
      }
    });
    child.stdin.end(fullPrompt);
  });
}

/** Pull the first JSON object/array out of a model reply (tolerates ``` fences). */
export function parseJsonReply(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in model reply');
  const open = body[start], close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * callModel({ role, system, prompt }) -> parsed JSON object.
 * Retries once if the reply is not valid JSON or fails `validate`.
 */
export async function callModel({ role, system, prompt, validate = x => x }) {
  const full = `${system}\n\nRespond with a single JSON object only, no prose, no markdown fences.\n\n${prompt}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const text = await runClaudeCli(full);
      const value = validate(parseJsonReply(text));
      console.log(`[llm] ${role} ok in ${Date.now() - t0}ms`);
      return value;
    } catch (e) {
      lastErr = e;
      console.warn(`[llm] ${role} attempt ${attempt + 1} failed: ${e.message}`);
    }
  }
  throw lastErr;
}
