/**
 * The single provider boundary for every model step (model_1 and model_2).
 * Default provider: the locally installed Claude Code CLI in print mode.
 * Swap `provider` to use an HTTP API instead; nothing else needs to change.
 */
import { spawn } from 'node:child_process';
import { z } from 'zod';

export interface ModelRequest<T> {
  /** Which model role in the design this call implements (model_1, model_2). */
  role: 'model_1' | 'model_2';
  /** Operation name from the design, for logs. */
  op: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export type Provider = (req: { system: string; prompt: string; jsonSchema: object }) => Promise<unknown>;

const claudeCliProvider: Provider = ({ system, prompt, jsonSchema }) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = [
      '-p',
      '--output-format', 'json',
      '--tools', '',
      '--system-prompt', system,
      '--json-schema', JSON.stringify(jsonSchema),
    ];
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`claude CLI error: ${parsed.result ?? err}`));
        if (parsed.structured_output !== undefined) return resolve(parsed.structured_output);
        // Fallback: parse JSON from the text result.
        const text: string = parsed.result ?? '';
        const m = text.match(/\{[\s\S]*\}/);
        resolve(m ? JSON.parse(m[0]) : text);
      } catch {
        reject(new Error(`claude CLI failed (exit ${code}): ${err || out.slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });

export let provider: Provider = claudeCliProvider;
export function setProvider(p: Provider) {
  provider = p;
}

/** Call a model with typed, validated output. Retries once when validation fails. */
export async function callModel<T>(req: ModelRequest<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(req.schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const raw = await provider({ system: req.system, prompt: req.prompt, jsonSchema });
      const result = req.schema.safeParse(raw);
      console.log(`[${req.role} ${req.op}] ${Date.now() - t0}ms ${result.success ? 'ok' : 'invalid'}`);
      if (result.success) return result.data;
      lastErr = new Error(`Invalid output for ${req.op}: ${result.error.message}`);
    } catch (e) {
      console.log(`[${req.role} ${req.op}] failed: ${(e as Error).message}`);
      lastErr = e;
    }
  }
  throw lastErr;
}
