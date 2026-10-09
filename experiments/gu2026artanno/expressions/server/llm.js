// The single entry point for every model step. Swap the provider here.
// Default provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 240000);
const MAX_CONCURRENCY = Number(process.env.CLAUDE_CONCURRENCY || 4);

let active = 0;
const waiting = [];
async function acquire() {
  if (active < MAX_CONCURRENCY) { active++; return; }
  await new Promise((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  const next = waiting.shift();
  if (next) next();
}

/**
 * Call a model and get back a JSON object that matches `schema`.
 * @param {object} opts
 * @param {string} opts.role     design actor, e.g. "model_3" (used for logging / per-role config)
 * @param {string} opts.system   system prompt for this role
 * @param {string} opts.prompt   user prompt built only from the preceding state
 * @param {object} opts.schema   JSON schema of the expected output
 * @param {string[]} [opts.images] absolute paths of images the model must look at
 * @param {(o:any)=>string|null} [opts.validate] extra validation; return an error message to retry
 * @returns {Promise<any>}
 */
export async function callModel({ role, system, prompt, schema, images = [], validate }) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const feedback = attempt > 0 && lastErr ? `\n\nYour previous answer was rejected: ${lastErr}. Fix it.` : '';
    try {
      const out = await claudeCli({ system, prompt: prompt + feedback, schema, images });
      const err = validate ? validate(out) : null;
      if (err) { lastErr = err; continue; }
      return out;
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(`${role} failed: ${lastErr}`);
}

function claudeCli({ system, prompt, schema, images }) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sysx-'));
  let fullPrompt = prompt;
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--no-session-persistence',
    '--system-prompt', system, '--json-schema', JSON.stringify(schema)];
  if (images.length) {
    const dirs = [...new Set(images.map((p) => path.dirname(p)))];
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', ...dirs);
    fullPrompt = `First use the Read tool to look at these image files:\n${images.map((p) => `- ${p}`).join('\n')}\n\n${prompt}`;
  } else {
    args.push('--tools', '');
  }
  return acquire().then(() => new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rm(cwd, { recursive: true, force: true }, () => {});
      try {
        const res = JSON.parse(stdout);
        if (res.is_error) return reject(new Error(res.result || 'model error'));
        if (res.structured_output) return resolve(res.structured_output);
        return resolve(parseJsonLoose(res.result));
      } catch (e) {
        reject(new Error(`bad CLI output (exit ${code}): ${(stderr || stdout).slice(0, 300)}`));
      }
    });
    child.stdin.end(fullPrompt);
  })).finally(release);
}

export function parseJsonLoose(text) {
  const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : text;
  const start = body.search(/[[{]/);
  return JSON.parse(body.slice(start));
}

export const providerInfo = { provider: 'claude-code-cli', model: MODEL };
