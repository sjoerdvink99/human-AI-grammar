// Single provider boundary: every model step in the design goes through callModel().
// Default provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
import { spawn } from 'node:child_process';

const CLI = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CLAUDE_MODEL || ''; // empty = CLI default
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 240000);

/**
 * @param {object} opts
 * @param {string} opts.role     design actor, e.g. "model_3" (for logging)
 * @param {string} opts.system   system prompt for this model role
 * @param {string} opts.prompt   user prompt, built only from the preceding state
 * @param {string[]} [opts.images] absolute image paths the model may read
 * @param {(v:any)=>any} [opts.validate] throws on invalid output; may return a cleaned value
 * @param {number} [opts.retries]
 * @returns {Promise<any>} parsed JSON output
 */
export async function callModel({ role, system, prompt, images = [], validate, retries = 1 }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await claudeCli({ system, prompt: buildPrompt(prompt, images, lastErr), images });
      const json = extractJson(text);
      return validate ? (validate(json) ?? json) : json;
    } catch (e) {
      lastErr = e;
      console.warn(`[${role}] attempt ${attempt + 1} failed: ${e.message}`);
    }
  }
  throw new Error(`${role}: ${lastErr?.message || 'model call failed'}`);
}

function buildPrompt(prompt, images, lastErr) {
  let p = prompt;
  if (images.length) {
    p = `Use the Read tool to look at each of these image files before answering:\n${images.map((f) => `- ${f}`).join('\n')}\n\n${p}`;
  }
  p += '\n\nRespond with a single JSON value only. No prose, no markdown fences.';
  if (lastErr) p += `\nYour previous answer was invalid (${lastErr.message}). Fix it.`;
  return p;
}

function claudeCli({ system, prompt, images }) {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (system) args.push('--append-system-prompt', system);
  if (MODEL) args.push('--model', MODEL);
  if (images.length) args.push('--allowedTools', 'Read');
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('model timeout')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error(`CLI error: ${env.result || env.subtype}`));
        resolve(String(env.result ?? ''));
      } catch {
        reject(new Error(`CLI exited ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
  });
}

export function extractJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('no JSON in output');
  const s = Math.min(...starts);
  const e = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  return JSON.parse(t.slice(s, e + 1));
}
