// The single provider boundary. Every model step in the design goes through callModel().
// The current provider shells out to the locally installed Claude Code CLI:
//   claude -p --output-format json --json-schema <schema>
// started with CLAUDECODE removed from the environment. To swap providers, replace runClaudeCli().
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export type ModelRole = 'model_1' | 'model_2' | 'model_3' | 'model_4';

interface RoleConfig {
  model: string;
  system: string;
  timeoutMs: number;
}

/** Distinct model roles from the design, each with its own configuration. */
export const ROLES: Record<ModelRole, RoleConfig> = {
  model_1: {
    model: process.env.MODEL_1 ?? 'sonnet',
    system:
      'You are model_1, a vision-language analyst inside a layered-papercut design tool. You look at illustrations (given as SVG source and/or a PNG file) and reason about depth layers, objects, style and occlusion. Answer only through the structured output.',
    timeoutMs: 240_000,
  },
  model_2: {
    model: process.env.MODEL_2 ?? 'sonnet',
    system:
      'You are model_2, an image generator and image editor. You produce images as self-contained SVG documents with viewBox="0 0 512 512", width="512" height="512". Use flat filled shapes (path, polygon, circle, ellipse, rect) in a clean vector-illustration style with clear silhouettes, no text, no external references, no <image>, no <script>, no filters, no masks. Give every visible shape a short unique id. Keep the document under ~80 shapes. Answer only through the structured output.',
    timeoutMs: 300_000,
  },
  model_3: {
    model: process.env.MODEL_3 ?? 'sonnet',
    system:
      'You are model_3, a promptable segmentation model. Given an image (SVG source whose shapes carry ids, and/or a PNG) and text prompts, you return for each prompt the region it refers to: the ids of SVG shapes that make up the object and/or polygons in pixel coordinates of the image. Be precise; include every shape belonging to the object and nothing else. Answer only through the structured output.',
    timeoutMs: 240_000,
  },
  model_4: {
    model: process.env.MODEL_4 ?? 'haiku',
    system:
      'You are model_4, a fabrication advisor for layered laser-cut / papercut artworks. You explain manufacturing-constraint problems plainly and translate chosen resolutions into exact tool calls. Answer only through the structured output.',
    timeoutMs: 180_000,
  },
};

export interface ModelRequest<T> {
  /** operation label for logs, e.g. "generate image_candidates" */
  op: string;
  prompt: string;
  /** output schema: used both as the CLI --json-schema and to validate the result */
  schema: z.ZodType<T>;
  /** PNG images (data URLs or buffers) the model should look at */
  images?: { name: string; png: string | Buffer }[];
}

export interface ModelLogEntry {
  role: ModelRole;
  op: string;
  ms: number;
  ok: boolean;
  error?: string;
  at: number;
}
export const modelLog: ModelLogEntry[] = [];

/** One function for every model call. Validates structured output and retries once. */
export async function callModel<T>(role: ModelRole, req: ModelRequest<T>): Promise<T> {
  const cfg = ROLES[role];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const raw = await runClaudeCli(cfg, req, attempt > 0 ? String(lastErr) : undefined);
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) throw new Error('Output failed validation: ' + parsed.error.message.slice(0, 600));
      modelLog.push({ role, op: req.op, ms: Date.now() - t0, ok: true, at: Date.now() });
      return parsed.data;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : e;
      modelLog.push({ role, op: req.op, ms: Date.now() - t0, ok: false, error: String(lastErr).slice(0, 300), at: Date.now() });
    }
  }
  throw new Error(`${role} ${req.op} failed: ${String(lastErr)}`);
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  return rest;
}

async function runClaudeCli<T>(cfg: RoleConfig, req: ModelRequest<T>, previousError?: string): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'systemx-'));
  try {
    let prompt = req.prompt;
    const hasImages = req.images && req.images.length > 0;
    if (hasImages) {
      const paths: string[] = [];
      for (const img of req.images!) {
        const buf = typeof img.png === 'string' ? Buffer.from(img.png.replace(/^data:image\/png;base64,/, ''), 'base64') : img.png;
        const p = join(dir, img.name.replace(/[^a-z0-9_.-]/gi, '_') + '.png');
        writeFileSync(p, buf);
        paths.push(p);
      }
      prompt =
        `First use the Read tool to look at these image file(s):\n${paths.map((p) => '- ' + p).join('\n')}\n\n` + prompt;
    }
    if (previousError) {
      prompt += `\n\nYour previous answer was rejected: ${previousError.slice(0, 500)}\nFix this in your new answer.`;
    }
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      cfg.model,
      '--system-prompt',
      cfg.system,
      '--json-schema',
      JSON.stringify(jsonSchemaOf(req.schema)),
      '--tools',
      hasImages ? 'Read' : '',
    ];
    if (hasImages) args.push('--allowedTools', 'Read', '--add-dir', dir);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn('claude', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`timeout after ${cfg.timeoutMs} ms`));
      }, cfg.timeoutMs);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`));
        else resolve(stdout);
      });
    });
    const envelope = JSON.parse(out);
    if (envelope.is_error) throw new Error('model error: ' + String(envelope.result).slice(0, 400));
    if (envelope.structured_output !== undefined && envelope.structured_output !== null) return envelope.structured_output;
    // Fallback: parse JSON from the text result.
    const text: string = envelope.result ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON in model output');
    return JSON.parse(m[0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
