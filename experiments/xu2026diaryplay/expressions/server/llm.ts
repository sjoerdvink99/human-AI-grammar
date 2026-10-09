// The single provider boundary: every model step in the app calls callModel().
// Swap this implementation to change provider (e.g. Anthropic SDK with an API key).
import { spawn } from "node:child_process";
import os from "node:os";

export interface ModelCall {
  /** system prompt: role + rules for this operation */
  system: string;
  /** user prompt: built only from the representations in the preceding state */
  prompt: string;
  /** JSON schema for structured output */
  schema: object;
  /** "authoring" (quality) or "runtime" (latency-sensitive, in-game) */
  tier?: "authoring" | "runtime";
}

const MODEL_AUTHORING = process.env.MODEL_AUTHORING || ""; // "" = CLI default
const MODEL_RUNTIME = process.env.MODEL_RUNTIME || "haiku";
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180_000);

export async function callModel<T>(call: ModelCall): Promise<T> {
  const model = call.tier === "runtime" ? MODEL_RUNTIME : MODEL_AUTHORING;
  const args = [
    "-p",
    call.prompt,
    "--output-format",
    "json",
    "--tools",
    "",
    "--system-prompt",
    call.system,
    "--json-schema",
    JSON.stringify(call.schema),
  ];
  if (model) args.push("--model", model);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { env, cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Model call timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
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

  let envelope: any;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse CLI output: ${stdout.slice(0, 300)}`);
  }
  if (envelope.is_error) throw new Error(`Model error: ${envelope.result ?? envelope.subtype}`);
  if (envelope.structured_output) return envelope.structured_output as T;
  // Fallback: parse JSON from the text result.
  const text: string = envelope.result ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Model returned no JSON: ${text.slice(0, 300)}`);
  return JSON.parse(match[0]) as T;
}
