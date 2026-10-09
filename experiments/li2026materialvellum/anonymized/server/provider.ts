// The single swap point for the model provider. Every model step goes through callModel().
// Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`),
// started with CLAUDECODE removed from the environment and with all tools disabled.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

export type ModelRole = "model_1" | "model_2";

export interface ModelCall {
  role: ModelRole;
  system: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ModelResult { text: string; costUsd?: number; durationMs?: number }

const MAX_CONCURRENT = Number(process.env.MAX_MODEL_CALLS ?? 3);
let running = 0;
const queue: (() => void)[] = [];
async function acquire() {
  if (running < MAX_CONCURRENT) { running++; return; }
  await new Promise<void>((r) => queue.push(r));
  running++;
}
function release() { running--; queue.shift()?.(); }

/** Per-role configuration: model_1 (image/SVG model) and model_2 (text model) are separate roles. */
const ROLE_MODEL: Record<ModelRole, string | undefined> = {
  model_1: process.env.MODEL_1 || undefined,
  model_2: process.env.MODEL_2 || undefined,
};

export async function callModel(call: ModelCall): Promise<ModelResult> {
  await acquire();
  try {
    return await runClaude(call);
  } finally {
    release();
  }
}

function runClaude({ role, system, prompt, timeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? 420_000) }: ModelCall): Promise<ModelResult> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--system-prompt", system];
  const model = ROLE_MODEL[role];
  if (model) args.push("--model", model);

  return new Promise((resolve, reject) => {
    // Run from a neutral directory so no project CLAUDE.md is picked up.
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { env, cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${role} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error || typeof j.result !== "string") throw new Error(j.result || j.subtype || "model error");
        resolve({ text: j.result, costUsd: j.total_cost_usd, durationMs: j.duration_ms });
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${(e as Error).message} ${err.slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
