// The single model-provider seam. Every model step (model_1 and model_2) goes through callModel().
// The default provider shells out to the locally installed Claude Code CLI:
//   claude -p --output-format json --json-schema <schema> --system-prompt <system>
// with CLAUDECODE removed from the environment. Swap the provider by replacing `activeProvider`.
import { spawn } from "node:child_process";

export interface ModelRequest {
  /** Which model role from the design (model_1 = writing/coaching, model_2 = speech). */
  role: "model_1" | "model_2";
  /** A short operation name used for logging, e.g. "extractBrief". */
  operation: string;
  system: string;
  prompt: string;
  /** A JSON Schema the output must follow. */
  schema: Record<string, unknown>;
}

export type ModelProvider = (req: ModelRequest) => Promise<unknown>;

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 180_000);

export const claudeCliProvider: ModelProvider = (req) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const args = [
      "-p",
      req.prompt,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(req.schema),
      "--system-prompt",
      req.system,
      "--tools",
      "",
      "--no-session-persistence",
    ];
    if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, {
      env,
      cwd: process.env.MODEL_CWD ?? "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${req.operation}: model timed out after ${TIMEOUT_MS} ms`));
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
        const envelope = JSON.parse(out);
        if (envelope.is_error) throw new Error(envelope.result ?? "model error");
        if (envelope.structured_output !== undefined) return resolve(envelope.structured_output);
        resolve(parseLooseJson(String(envelope.result ?? "")));
      } catch (e) {
        reject(new Error(`${req.operation}: CLI exit ${code}: ${(e as Error).message} ${err.slice(0, 500)}`));
      }
    });
  });

/** Fallback for when structured_output is missing: take the first JSON object from the text. */
export function parseLooseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

let activeProvider: ModelProvider = claudeCliProvider;
export function setProvider(p: ModelProvider) {
  activeProvider = p;
}

export async function callModel<T>(req: ModelRequest, validate: (x: unknown) => T): Promise<T> {
  const t0 = Date.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await activeProvider(req);
      const value = validate(raw);
      console.log(`[${req.role} ${req.operation}] ok in ${Date.now() - t0} ms (attempt ${attempt})`);
      return value;
    } catch (e) {
      lastErr = e;
      console.warn(`[${req.role} ${req.operation}] attempt ${attempt} failed: ${(e as Error).message}`);
    }
  }
  throw lastErr;
}
