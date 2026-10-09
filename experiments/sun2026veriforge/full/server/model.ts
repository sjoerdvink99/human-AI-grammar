// model_1 (language model) provider. Every model step goes through callModel,
// so the provider can be swapped by replacing this one function.
import { spawn } from "node:child_process";
import os from "node:os";

export interface ModelRequest {
  /** short name of the design operation, for logs */
  op: string;
  system: string;
  prompt: string;
  /** JSON schema for structured output */
  schema: object;
}

const MODEL = process.env.CLAUDE_MODEL ?? "sonnet";
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 180_000);

export async function callModel<T>(req: ModelRequest): Promise<T> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    "-p",
    "--output-format", "json",
    "--model", MODEL,
    "--tools", "",
    "--no-session-persistence",
    "--system-prompt", req.system,
    "--json-schema", JSON.stringify(req.schema),
  ];
  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { env, cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`model call ${req.op} timed out`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(req.prompt);
  });
  let envelope: { result?: string; structured_output?: unknown; is_error?: boolean };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`model call ${req.op}: unparseable CLI output`);
  }
  if (envelope.is_error) throw new Error(`model call ${req.op} failed: ${envelope.result ?? "unknown error"}`);
  let value = envelope.structured_output;
  if (value === undefined && envelope.result) {
    const m = envelope.result.match(/\{[\s\S]*\}/);
    if (m) value = JSON.parse(m[0]);
  }
  if (value === undefined) throw new Error(`model call ${req.op}: no structured output`);
  console.log(`[model_1 ${req.op}] ${Date.now() - started} ms`);
  return value as T;
}
