// Single model-provider entry point. Swap the body of callModel() to change provider.
// Current provider: the locally installed Claude Code CLI in print mode with structured output.
import { spawn } from 'node:child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || ''; // empty = CLI default
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

/**
 * @param {object} opts
 * @param {string} opts.system  system prompt for this model role
 * @param {string} opts.prompt  user content
 * @param {object} opts.schema  JSON schema for the structured output
 * @returns {Promise<object>} the parsed structured output
 */
export async function callModel({ system, prompt, schema }) {
  if (process.env.MOCK_MODEL) return mockModel({ system, prompt, schema });
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--system-prompt', system,
    '--tools', '',
    '--no-session-persistence',
  ];
  if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Model call timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(prompt);
  });

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (envelope.is_error) throw new Error(`Model error: ${envelope.result || envelope.subtype}`);
  if (envelope.structured_output) return envelope.structured_output;
  // Fallback: parse JSON out of the text result.
  const text = String(envelope.result || '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Model returned no JSON');
  return JSON.parse(m[0]);
}

// Deterministic stand-in used by tests (MOCK_MODEL=1).
function mockModel({ schema }) {
  const props = schema.properties || {};
  if (props.triggered) return { triggered: [] };
  if (props.revised_prompt) return { revised_prompt: 'mock revised', lint_messages: [] };
  if (props.code) return { code: 'print("mock")' };
  if (props.proposals) return { proposals: [] };
  return {};
}
