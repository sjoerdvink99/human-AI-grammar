// The single swap point for the model provider.
// Every model step in the design ([model_1 generate] … [model_5 generate]) calls callModel().
// Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
import { spawn } from 'node:child_process';
import os from 'node:os';

const MAX_CONCURRENT = Number(process.env.MODEL_CONCURRENCY || 4);
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 240000);
let running = 0;
const queue = [];

function acquire() {
  return new Promise((resolve) => {
    if (running < MAX_CONCURRENT) { running++; resolve(); }
    else queue.push(resolve);
  });
}
function release() {
  const next = queue.shift();
  if (next) next(); else running--;
}

/**
 * @param {{system: string, prompt: string, model?: string}} req
 * @returns {Promise<string>} the model's text answer
 */
export async function callModel({ system, prompt, model }) {
  if (process.env.MODEL_PROVIDER === 'mock') return mockModel({ system, prompt });
  await acquire();
  try {
    return await callClaudeCli({ system, prompt, model });
  } finally {
    release();
  }
}

function callClaudeCli({ system, prompt, model }) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--system-prompt', system,
  ];
  const m = model || process.env.CLAUDE_MODEL;
  if (m) args.push('--model', m);
  return new Promise((resolve, reject) => {
    // run from the temp dir so no project CLAUDE.md is picked up
    const child = spawn('claude', args, { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Model call timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(parsed.result || 'Model error'));
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error(`claude CLI failed (code ${code}): ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

// Deterministic stand-in used by tests (MODEL_PROVIDER=mock).
function mockModel({ system }) {
  if (system.includes('KEYWORDS')) return 'apple | 9\nleaf | 7\nharvest | 6\norchard | 5\nbasket | 4';
  if (system.includes('SEGMENT')) return '{"masks":[{"name":"part","eids":["e0"]}]}';
  if (system.includes('DESCRIBE')) return '{"descriptions":["a simple shape"]}';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="80" fill="#e44"/><rect x="118" y="30" width="20" height="40" fill="#3a3"/></svg>';
}
