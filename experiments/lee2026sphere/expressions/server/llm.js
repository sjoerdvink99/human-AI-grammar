// The single model-provider function. Every [model_n op] step goes through callModel().
// Provider: locally installed Claude Code CLI (`claude -p --output-format json`).
// To swap providers, reimplement this function with the same signature.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CLAUDE_MODEL || ''; // empty = CLI default
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

/**
 * @param {object} opts
 * @param {string} opts.role     model role name, e.g. "model_2" (for logging)
 * @param {string} opts.system   system prompt for this role
 * @param {string} opts.prompt   user prompt, built only from the preceding state
 * @param {object} opts.schema   JSON schema; the result is validated structured output
 * @param {string[]} [opts.images] absolute paths of image files the model must look at
 * @returns {Promise<object>} parsed structured output
 */
export async function callModel({ role, system, prompt, schema, images = [] }) {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--system-prompt', system];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (MODEL) args.push('--model', MODEL);
  let fullPrompt = prompt;
  let cwd = os.tmpdir();
  if (images.length) {
    // The CLI can only see images through its Read tool.
    args.push('--tools', 'Read', '--allowedTools', 'Read');
    cwd = path.dirname(images[0]);
    fullPrompt = `First use the Read tool to look at these image file(s): ${images.join(', ')}\n\n${prompt}`;
  } else {
    args.push('--tools', '');
  }
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const started = Date.now();
  const out = await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${role}: model timed out`)); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) return reject(new Error(`${role}: claude exited ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout);
    });
    child.stdin.end(fullPrompt);
  });
  let envelope;
  try { envelope = JSON.parse(out); } catch { throw new Error(`${role}: unparseable CLI output: ${out.slice(0, 300)}`); }
  if (envelope.is_error) throw new Error(`${role}: ${envelope.result || 'model error'}`);
  let result = envelope.structured_output;
  if (result === undefined && schema) result = extractJson(envelope.result);
  if (result === undefined) result = envelope.result;
  console.log(`[${role}] ${Date.now() - started}ms`);
  return result;
}

function extractJson(text) {
  if (typeof text !== 'string') return undefined;
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return undefined;
  try { return JSON.parse(m[0]); } catch { return undefined; }
}

/** Write a data: URL image to a temp file and return its path. */
export function dataUrlToTempFile(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('topdown_view must be a PNG or JPEG data URL');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'systemx-'));
  const file = path.join(dir, `topdown.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}
