// The single model-provider function. Every [model …] step in the design goes through
// callModel(). To swap providers (e.g. the Anthropic API), reimplement this function only.
import { spawn } from 'node:child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || ''; // empty = CLI default
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

/**
 * Call the model with a system prompt, a user prompt and a JSON schema for structured output.
 * @param {{system: string, prompt: string, schema: object, label?: string}} args
 * @returns {Promise<any>} parsed JSON matching `schema` (validated again by the caller)
 */
export async function callModel({ system, prompt, schema, label = 'model' }) {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--system-prompt', system,
    '--json-schema', JSON.stringify(schema),
    '--tools', '',
  ];
  if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const started = Date.now();
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label}: model call timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`${label}: claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
  });

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`${label}: could not parse CLI output`);
  }
  if (envelope.is_error) throw new Error(`${label}: ${envelope.result || 'model error'}`);
  console.log(`[model] ${label} ${Date.now() - started} ms`);

  if (envelope.structured_output && typeof envelope.structured_output === 'object') {
    return envelope.structured_output;
  }
  return parseJsonLoose(envelope.result);
}

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('model returned no text');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('model returned no JSON');
  return JSON.parse(body.slice(start, Math.max(body.lastIndexOf('}'), body.lastIndexOf(']')) + 1));
}
