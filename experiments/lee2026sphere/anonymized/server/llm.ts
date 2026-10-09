// The single model-provider boundary. Every model step (model_2 … model_7) calls
// callModel(); swap this function to change provider.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ModelCall {
  role: string; // design actor, e.g. "model_4"
  system: string;
  prompt: string;
  timeoutMs?: number;
}

const MODEL = process.env.CLAUDE_MODEL ?? 'sonnet';
const sandboxDir = mkdtempSync(join(tmpdir(), 'systemx-llm-'));

/** Raw text completion via the local Claude Code CLI. */
export async function callModel({ role, system, prompt, timeoutMs = 180_000 }: ModelCall): Promise<string> {
  if (process.env.MOCK_MODEL) return mockModel(role, prompt);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--system-prompt', system, '--tools', ''];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, cwd: sandboxDir, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${role}: model call timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`${role}: ${parsed.result ?? 'model error'}`));
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error(`${role}: CLI exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Extract the first JSON value from model text. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in model output');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
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
 * Call the model, parse JSON and validate with `validate` (which throws on bad shape).
 * Retries once with the validation error appended.
 */
export async function callModelJson<T>(call: ModelCall, validate: (v: unknown) => T): Promise<T> {
  let lastErr: unknown;
  let prompt = call.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callModel({ ...call, prompt });
      return validate(extractJson(text));
    } catch (e) {
      lastErr = e;
      prompt = `${call.prompt}\n\nYour previous answer was invalid (${(e as Error).message}). Answer again with valid JSON only.`;
    }
  }
  throw lastErr;
}

// Deterministic stand-in used by tests (MOCK_MODEL=1); not used in normal runs.
function mockModel(role: string, prompt: string): string {
  const ids = [...prompt.matchAll(/"(?:assetId|id)":\s*"([^"]+)"/g)].map((m) => m[1]);
  switch (role) {
    case 'model_3': return JSON.stringify({ vector: Array.from({ length: 16 }, (_, i) => (i === 0 || i === 4 || i === 15 ? 0.9 : 0.1)) });
    case 'model_4': return JSON.stringify({ rows: [...new Set(ids)].map((id, i) => ({ assetId: id, relevance: 9 - i, reason: 'mock' })) });
    case 'model_5': return JSON.stringify({ rows: [...new Set(ids)].slice(0, 4).map((id, i) => ({ slot: `slot${i}`, assetId: id, count: 1, confidence: 0.8 })) });
    case 'model_2_translate': return JSON.stringify({ action: 'move', targets: ids.slice(0, 1), parameters: { dx: 50 }, explanation: 'mock' });
    case 'model_2_decompose': return JSON.stringify({ ops: ids.slice(0, 1).map((t) => ({ op: 'move', target: t, dx: 50, dy: 0 })) });
    case 'model_6_expand': return JSON.stringify({ groups: [] });
    case 'model_6_extract': return JSON.stringify({ assets: [] });
    case 'model_7': return JSON.stringify({ judgements: [] });
    default: return '{}';
  }
}
