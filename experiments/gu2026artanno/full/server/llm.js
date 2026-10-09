// Single provider boundary for every [model_n ...] step (and the tool_1 vision substitute).
// Swap the body of `callModel` to change provider.
import { spawn } from 'node:child_process';
import path from 'node:path';

const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 240000);

/**
 * Call the language model once.
 * @param {object} o
 * @param {string} o.system   role/instructions for this actor
 * @param {string} o.prompt   user content built from the preceding state
 * @param {string[]} [o.images] absolute image paths the model may read
 * @returns {Promise<string>} raw text output
 */
export async function callModel({ system, prompt, images = [] }) {
  if (process.env.MOCK_LLM) return mockReply(system, prompt);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  let full = `${system}\n\n${prompt}`;
  const args = ['-p', '--output-format', 'json', '--model', MODEL];
  if (images.length) {
    full += `\n\nImage files (open each with the Read tool before answering):\n${images.map((p) => '- ' + p).join('\n')}`;
    args.push('--tools', 'Read', '--allowedTools', 'Read');
    const dirs = [...new Set(images.map((p) => path.dirname(p)))];
    for (const d of dirs) args.push('--add-dir', d);
  } else {
    args.push('--tools', '');
  }
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error('model error: ' + (j.result || j.subtype)));
        resolve(String(j.result ?? ''));
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.end(full);
  });
}

/** Extract the first JSON value from model text. */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in model output');
  const open = body[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in model output');
}

/**
 * Structured model call: prompt → JSON validated by a zod schema, one repair retry.
 * @template T
 * @param {{system:string, prompt:string, images?:string[], schema: import('zod').ZodType<T>, check?: (v:T)=>string|null}} o
 * @returns {Promise<T>}
 */
export async function callModelJson({ system, prompt, images, schema, check }) {
  const sys = `${system}\nRespond with a single JSON value only, no prose, no markdown fences.`;
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was invalid: ${lastErr}\nReturn corrected JSON only.`;
    let text;
    try { text = await callModel({ system: sys, prompt: p, images }); }
    catch (e) { lastErr = e.message; if (attempt) throw e; continue; }
    try {
      const v = schema.parse(extractJson(text));
      const problem = check ? check(v) : null;
      if (!problem) return v;
      lastErr = problem;
    } catch (e) { lastErr = String(e.message).slice(0, 600); }
  }
  throw new Error('model output failed validation: ' + lastErr);
}

// Deterministic stand-in used by tests (MOCK_LLM=1); never used in normal runs.
let mockHandler = null;
export function setMockHandler(fn) { mockHandler = fn; }
function mockReply(system, prompt) {
  if (!mockHandler) throw new Error('MOCK_LLM set but no mock handler');
  return Promise.resolve(mockHandler(system, prompt));
}
