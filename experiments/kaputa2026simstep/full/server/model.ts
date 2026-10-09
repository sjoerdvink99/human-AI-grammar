// The single model provider boundary. Every model step in the design goes through callModel().
// Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
// To swap providers, reimplement this function; the rest of the server is provider-agnostic.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const TMP_DIR = resolve(process.cwd(), '.tmp');
mkdirSync(TMP_DIR, { recursive: true });

export interface ModelRequest {
  /** a short name of the design operation, used for logs */
  op: string;
  system: string;
  prompt: string;
  /** JSON Schema; when given, the structured output object is returned */
  schema?: object;
  /** images as data URLs (png/jpeg) that the model must look at */
  images?: { name: string; dataUrl: string }[];
  timeoutMs?: number;
}

export interface ModelResponse {
  text: string;
  structured?: unknown;
}

function saveImage(dataUrl: string, name: string): string {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error(`image ${name} is not a base64 png/jpeg data URL`);
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const file = join(TMP_DIR, `${randomUUID()}-${name.replace(/[^a-z0-9_-]/gi, '_')}.${ext}`);
  writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  let prompt = req.prompt;
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--system-prompt', req.system];
  if (process.env.SYSTEMX_MODEL) args.push('--model', process.env.SYSTEMX_MODEL);
  if (req.images?.length) {
    const files = req.images.map((im) => ({ name: im.name, file: saveImage(im.dataUrl, im.name) }));
    prompt +=
      '\n\nIMAGES — first read each of these image files with the Read tool and look at them carefully:\n' +
      files.map((f) => `- ${f.name}: ${f.file}`).join('\n');
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', TMP_DIR);
  } else {
    args.push('--tools', '');
  }
  if (req.schema) args.push('--json-schema', JSON.stringify(req.schema));

  const env = { ...process.env };
  delete env.CLAUDECODE;
  const started = Date.now();
  console.log(`[model] ${req.op} …`);

  const stdout = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn('claude', args, { env, cwd: TMP_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`model call ${req.op} timed out`));
    }, req.timeoutMs ?? 15 * 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      else resolvePromise(out);
    });
    child.stdin.end(prompt);
  });

  let parsed: { result?: string; structured_output?: unknown; is_error?: boolean };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`model ${req.op}: could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (parsed.is_error) throw new Error(`model ${req.op} failed: ${String(parsed.result).slice(0, 300)}`);
  console.log(`[model] ${req.op} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  let structured = parsed.structured_output;
  if (req.schema && structured === undefined && parsed.result) {
    // fall back to parsing JSON from the text
    const m = /\{[\s\S]*\}/.exec(parsed.result);
    if (m) structured = JSON.parse(m[0]);
  }
  return { text: parsed.result ?? '', structured };
}
