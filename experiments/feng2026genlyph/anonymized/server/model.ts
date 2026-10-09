/**
 * The single provider boundary for every model step in the design
 * (model_1 … model_5). Swap the body of `callModel` to change provider.
 *
 * Current provider: the locally installed Claude Code CLI, run as
 *   claude -p --output-format json --tools "" --model <model>
 * with the CLAUDECODE environment variable removed.
 */
import { spawn } from "node:child_process";

export interface ModelRequest {
  /** Which design role is calling, e.g. "model_1"; used for logs and model choice. */
  role: string;
  system: string;
  prompt: string;
  /** "text" for prose, "svg" for SVG markup, "json" for structured output. */
  kind: "text" | "svg" | "json";
}

const TEXT_MODEL = process.env.TEXT_MODEL ?? "haiku";
const SVG_MODEL = process.env.SVG_MODEL ?? "sonnet";
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 240_000);
const MAX_CONCURRENT = Number(process.env.MODEL_CONCURRENCY ?? 4);

let running = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (running < MAX_CONCURRENT) {
    running++;
    return;
  }
  await new Promise<void>((r) => waiting.push(r));
  running++;
}
function release() {
  running--;
  waiting.shift()?.();
}

export async function callModel(req: ModelRequest): Promise<string> {
  await acquire();
  const started = Date.now();
  try {
    const model = req.kind === "svg" ? SVG_MODEL : TEXT_MODEL;
    const text = await runClaude(req.system, req.prompt, model);
    console.log(`[${req.role}] ${model} ${req.kind} ok in ${Date.now() - started}ms`);
    return text;
  } catch (e) {
    console.error(`[${req.role}] failed after ${Date.now() - started}ms:`, (e as Error).message);
    throw e;
  } finally {
    release();
  }
}

function runClaude(system: string, prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model, "--tools", "", "--system-prompt", system],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`model timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error || typeof parsed.result !== "string") {
          reject(new Error(`claude error: ${parsed.result ?? parsed.subtype ?? "unknown"}`));
        } else resolve(parsed.result);
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Pull the first JSON object out of a model reply (tolerates code fences / prose). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model reply contained no JSON object");
  return JSON.parse(body.slice(start, end + 1)) as T;
}
