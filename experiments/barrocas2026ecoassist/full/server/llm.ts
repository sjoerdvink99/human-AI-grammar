import { spawn } from "node:child_process";

/**
 * The single provider boundary for every model step (model_1 and model_2).
 * Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`).
 * Swap this function to change provider; callers only see (system, prompt, model) → text.
 */
export interface ModelCall {
  system: string;
  prompt: string;
  model: string;
  timeoutMs?: number;
}

export async function callModel({ system, prompt, model, timeoutMs = 240_000 }: ModelCall): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    "-p",
    "--output-format", "json",
    "--model", model,
    "--system-prompt", system,
    "--tools", "",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || "claude", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`model call timed out after ${timeoutMs} ms`));
    }, timeoutMs);
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
        if (parsed.is_error) return reject(new Error(`model error: ${parsed.result ?? parsed.subtype}`));
        resolve(String(parsed.result ?? ""));
      } catch {
        reject(new Error(`claude CLI exited ${code}: ${err || out.slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Extract and parse the first JSON object from a model reply (handles ```json fences). */
export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("model reply contained no JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
