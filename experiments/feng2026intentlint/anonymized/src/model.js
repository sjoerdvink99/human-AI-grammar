// The single provider boundary for every model step (model_1 … model_4).
// Swap the body of callModel() to use another provider; callers only rely on
// callModel({ system, prompt, schema }) -> Promise<object matching schema>.
import { spawn } from 'node:child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

export async function callModel({ system, prompt, schema, model = process.env.MODEL_NAME }) {
  const args = ['-p', '--output-format', 'json', '--tools', '', '--system-prompt', system];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (model) args.push('--model', model);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Model call timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(prompt);
  });

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error('Model returned non-JSON envelope');
  }
  if (envelope.is_error) throw new Error(`Model error: ${envelope.result || envelope.subtype}`);
  if (!schema) return envelope.result;
  if (envelope.structured_output) return envelope.structured_output;
  return parseJsonLoose(envelope.result);
}

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('Model returned no text');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model output contained no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}
