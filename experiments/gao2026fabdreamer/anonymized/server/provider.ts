// The single swap point for model providers. Every model step in the app calls callModel().
// Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`),
// started with CLAUDECODE removed from the environment.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ModelRole = "model_1" | "model_2" | "model_3" | "model_4";

export interface ModelRequest {
  role: ModelRole;
  system: string;
  prompt: string;
  /** JSON Schema the output must follow. */
  schema: Record<string, unknown>;
  timeoutMs?: number;
}

/** Per-role CLI model. Override with MODEL_1 … MODEL_4 environment variables. */
const ROLE_MODEL: Record<ModelRole, string> = {
  model_1: process.env.MODEL_1 ?? "sonnet",
  model_2: process.env.MODEL_2 ?? "sonnet",
  model_3: process.env.MODEL_3 ?? "sonnet",
  model_4: process.env.MODEL_4 ?? "sonnet",
};

const sandbox = mkdtempSync(join(tmpdir(), "systemx-claude-"));

export async function callModel<T = unknown>(req: ModelRequest): Promise<T> {
  if (process.env.MODEL_PROVIDER === "mock") throw new Error("mock provider: no model available");
  return callClaudeCli<T>(req);
}

function callClaudeCli<T>(req: ModelRequest): Promise<T> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    "-p", req.prompt,
    "--output-format", "json",
    "--model", ROLE_MODEL[req.role],
    "--system-prompt", req.system,
    "--json-schema", JSON.stringify(req.schema),
    "--tools", "",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { env, cwd: sandbox, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${req.role} timed out`)); }, req.timeoutMs ?? 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error(`${req.role}: ${env.result ?? env.subtype ?? "model error"}`));
        if (env.structured_output !== undefined && env.structured_output !== null) return resolve(env.structured_output as T);
        resolve(parseLooseJson(String(env.result ?? "")) as T);
      } catch (e) {
        reject(new Error(`${req.role} failed (exit ${code}): ${(err || out).slice(0, 400) || String(e)}`));
      }
    });
  });
}

function parseLooseJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.search(/[[{]/);
  return JSON.parse(start >= 0 ? body.slice(start) : body);
}
