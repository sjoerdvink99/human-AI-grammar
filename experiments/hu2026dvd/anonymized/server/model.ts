import { spawn } from "node:child_process";

export interface ModelCall {
  /** Role-specific system prompt (model_1 / model_2 / model_3 each have their own). */
  system: string;
  prompt: string;
  /** JSON Schema the output must satisfy (structured output). */
  schema: object;
  /** Absolute paths of image files the model may read (vision). */
  imagePaths?: string[];
  timeoutMs?: number;
}

/**
 * The single model function. Every model step goes through here so the provider can be swapped.
 * Current provider: the locally installed Claude Code CLI (`claude -p --output-format json`),
 * started with CLAUDECODE removed from the environment.
 */
export async function callModel<T = unknown>(call: ModelCall): Promise<T> {
  const args = [
    "-p",
    call.prompt,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(call.schema),
    "--system-prompt",
    call.system,
    "--no-session-persistence",
  ];
  if (call.imagePaths?.length) {
    args.push("--tools", "Read", "--allowedTools", "Read");
    for (const p of call.imagePaths) args.push("--add-dir", p.replace(/\/[^/]*$/, ""));
  } else {
    args.push("--tools", "");
  }
  if (process.env.MODEL) args.push("--model", process.env.MODEL);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || "claude", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Model call timed out"));
    }, call.timeoutMs ?? 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
  });

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (parsed.is_error) throw new Error(`Model error: ${String(parsed.result ?? parsed.subtype).slice(0, 300)}`);
  if (parsed.structured_output != null) return parsed.structured_output as T;
  // fallback: result text containing JSON
  const text: string = parsed.result ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Model returned no structured output");
  return JSON.parse(m[0]) as T;
}
