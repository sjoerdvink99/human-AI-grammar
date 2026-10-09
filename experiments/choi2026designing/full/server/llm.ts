// The single model-provider boundary. Every model step (model_1 and model_2)
// goes through callModel(). To switch provider (e.g. Anthropic API), replace
// the body of runClaudeCli() — nothing else in the app talks to a model.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { z } from "zod";

export type ModelRole = "model_1" | "model_2";

const MODEL_FOR_ROLE: Record<ModelRole, string> = {
  model_1: process.env.MODEL_1 ?? "sonnet",
  model_2: process.env.MODEL_2 ?? "sonnet",
};

export interface ModelCall<T extends z.ZodType> {
  role: ModelRole;
  /** name of the grammar operation, for logs, e.g. "model_1 extract" */
  op: string;
  system: string;
  prompt: string;
  schema: T;
}

export async function callModel<T extends z.ZodType>(call: ModelCall<T>): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(call.schema, { target: "draft-7" });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const raw = await runClaudeCli(MODEL_FOR_ROLE[call.role], call.system, call.prompt, jsonSchema);
      const parsed = call.schema.safeParse(raw);
      if (parsed.success) {
        console.log(`[${call.op}] ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return parsed.data;
      }
      lastError = new Error(`Model output failed validation: ${parsed.error.message}`);
    } catch (err) {
      lastError = err;
    }
    console.warn(`[${call.op}] attempt ${attempt} failed:`, (lastError as Error).message);
  }
  throw lastError;
}

function runClaudeCli(model: string, system: string, prompt: string, schema: unknown): Promise<unknown> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--system-prompt", system,
    "--tools", "",
    "--no-session-persistence",
    "--model", model,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { env, cwd: tmpdir() });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const envelope = JSON.parse(out);
        if (envelope.is_error) return reject(new Error(`claude error: ${envelope.result ?? err}`));
        if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
          return resolve(envelope.structured_output);
        }
        resolve(extractJson(String(envelope.result ?? "")));
      } catch (e) {
        reject(new Error(`claude CLI failed (code ${code}): ${err || out.slice(0, 500) || (e as Error).message}`));
      }
    });
    child.stdin.end(prompt);
  });
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  return JSON.parse(body.slice(start));
}
