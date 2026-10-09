// The single model provider function. Every model step (model_1, model_2) goes through callModel.
// To swap providers, replace the body of callModel; callers only depend on its signature.
import { spawn } from "node:child_process";

export type ModelRole = "model_1" | "model_2";

export interface ModelCall {
  role: ModelRole;
  /** Short operation name used for logging, e.g. "P3 extract". */
  op: string;
  system: string;
  prompt: string;
  /** JSON schema of the structured output. */
  schema: object;
}

const ROLE_CONFIG: Record<ModelRole, { model?: string }> = {
  // model_1: generative LLM for extraction and generation.
  model_1: { model: process.env.MODEL_1 },
  // model_2: translation of text items into numeric vectors; may use a smaller/faster model.
  model_2: { model: process.env.MODEL_2 },
};

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 180_000);

export async function callModel<T>(call: ModelCall): Promise<T> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--json-schema",
    JSON.stringify(call.schema),
    "--system-prompt",
    call.system,
  ];
  const model = ROLE_CONFIG[call.role].model;
  if (model) args.push("--model", model);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${call.op}: model call timed out`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`${call.op}: claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(call.prompt);
  });

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`${call.op}: could not parse CLI output`);
  }
  if (parsed.is_error) throw new Error(`${call.op}: ${parsed.result ?? "model error"}`);
  let data = parsed.structured_output;
  if (data === undefined && typeof parsed.result === "string") {
    const m = parsed.result.match(/\{[\s\S]*\}/);
    if (m) data = JSON.parse(m[0]);
  }
  if (data === undefined) throw new Error(`${call.op}: no structured output`);
  console.log(`[${call.role}] ${call.op} ${Date.now() - started}ms`);
  return data as T;
}
