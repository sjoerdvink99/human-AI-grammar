/**
 * The single model-provider seam. Every model step in the design (model_1, model_2, model_3)
 * goes through callModel(). Today it shells out to the local Claude Code CLI; swap the body
 * of runClaudeCli() for an API client to change providers.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export interface ModelCall<S extends z.ZodTypeAny> {
  /** Which model role in the design this call implements (model_1, model_2, model_3). */
  role: 'model_1' | 'model_2' | 'model_3';
  system: string;
  prompt: string;
  schema: S;
  /** Optional images (PNG buffers) the model must look at. */
  images?: { name: string; data: Buffer }[];
  timeoutMs?: number;
}

export class ModelError extends Error {}

export async function callModel<S extends z.ZodTypeAny>(call: ModelCall<S>): Promise<z.infer<S>> {
  const jsonSchema = z.toJSONSchema(call.schema, { target: 'draft-7' });
  const raw = await runClaudeCli(call, JSON.stringify(jsonSchema));
  const parsed = call.schema.safeParse(raw);
  if (!parsed.success) {
    throw new ModelError(`${call.role} returned output that failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function runClaudeCli(call: ModelCall<z.ZodTypeAny>, jsonSchema: string): Promise<unknown> {
  // Run in an empty temp dir so no project CLAUDE.md / settings leak into the prompt.
  const dir = await mkdtemp(path.join(tmpdir(), `systemx-${call.role}-`));
  try {
    let prompt = call.prompt;
    const args = ['-p', '--output-format', 'json', '--json-schema', jsonSchema, '--system-prompt', call.system];
    if (process.env.SYSTEMX_MODEL) args.push('--model', process.env.SYSTEMX_MODEL);
    if (call.images?.length) {
      const files: string[] = [];
      for (const img of call.images) {
        const p = path.join(dir, img.name);
        await writeFile(p, img.data);
        files.push(p);
      }
      args.push('--tools', 'Read', '--allowedTools', 'Read');
      prompt += `\n\nFirst use the Read tool to look at these image files:\n${files.map((f) => `- ${f}`).join('\n')}`;
    } else {
      args.push('--tools', '');
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('claude', args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new ModelError(`${call.role} timed out`));
      }, call.timeoutMs ?? 300_000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new ModelError(`could not start claude CLI: ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !out) reject(new ModelError(`claude CLI exited ${code}: ${err.slice(0, 500)}`));
        else resolve(out);
      });
      child.stdin.end(prompt);
    });

    let envelope: { is_error?: boolean; result?: string; structured_output?: unknown };
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw new ModelError(`claude CLI returned non-JSON output: ${stdout.slice(0, 300)}`);
    }
    if (envelope.is_error) throw new ModelError(`claude CLI error: ${envelope.result ?? 'unknown'}`);
    if (envelope.structured_output !== undefined) return envelope.structured_output;
    // Fallback: pull JSON out of the text result.
    const text = envelope.result ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new ModelError('model returned no JSON');
    return JSON.parse(match[0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
