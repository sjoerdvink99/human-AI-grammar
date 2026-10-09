import { spawn } from "node:child_process";
import os from "node:os";

export interface LLMRequest {
  /** model role from the design, e.g. "model_1"; used for logging and per-role config */
  role: string;
  system: string;
  prompt: string;
  /** model alias passed to the provider */
  model?: string;
  timeoutMs?: number;
}

/**
 * The single entry point for every language-model call.
 * Current provider: the local Claude Code CLI (`claude -p --output-format json`),
 * started without the CLAUDECODE env var. Swap the body to use another provider.
 */
export async function callLLM(req: LLMRequest): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    "-p",
    "--output-format", "json",
    "--tools", "",
    "--no-session-persistence",
    "--model", req.model ?? process.env.CLAUDE_MODEL ?? "sonnet",
    "--system-prompt", req.system,
  ];
  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { env, cwd: os.tmpdir() });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${req.role}: LLM call timed out`));
    }, req.timeoutMs ?? 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`${req.role}: claude exited ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(req.prompt);
  });
  let parsed: { result?: string; is_error?: boolean };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`${req.role}: could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (parsed.is_error || typeof parsed.result !== "string") {
    throw new Error(`${req.role}: model error: ${String(parsed.result).slice(0, 300)}`);
  }
  console.log(`[llm] ${req.role} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return parsed.result;
}

/** Pull the first JSON value out of a model reply (tolerates ```json fences and prose). */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in model output");
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(close);
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Call the model expecting JSON and validate it; on a validation failure retry once,
 * telling the model what was wrong.
 */
export async function callJSON<T>(req: LLMRequest, validate: (v: unknown) => T): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? req.prompt : `${req.prompt}\n\nYour previous answer was invalid (${lastError}). Reply with valid JSON only.`;
    const text = await callLLM({ ...req, prompt });
    try {
      return validate(extractJSON(text));
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(`${req.role}: invalid model output: ${lastError}`);
}
