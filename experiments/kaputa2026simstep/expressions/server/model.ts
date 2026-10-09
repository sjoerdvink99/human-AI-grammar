// The single model-provider function. Swap the body to use another provider.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface ModelRequest {
  /** Role/system instructions for this operation. */
  system: string;
  /** User content built only from the representations in the preceding state. */
  prompt: string;
  /** Optional PNG images as data URLs; the model reads them as files. */
  images?: { name: string; dataUrl: string }[];
  /** Label for logs. */
  op: string;
}

const MODEL = process.env.CLAUDE_MODEL; // optional override, e.g. "sonnet"
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 10 * 60 * 1000);

export async function callModel(req: ModelRequest): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "systemx-"));
  try {
    let prompt = req.prompt;
    const files: string[] = [];
    for (const img of req.images ?? []) {
      const b64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const f = path.join(dir, img.name.replace(/[^\w.-]/g, "_"));
      await writeFile(f, Buffer.from(b64, "base64"));
      files.push(f);
    }
    if (files.length) {
      prompt +=
        `\n\nImages for this task (open each with the Read tool before answering):\n` +
        files.map((f) => `- ${f}`).join("\n");
    }
    const args = [
      "-p",
      "--output-format",
      "json",
      "--append-system-prompt",
      req.system +
        "\nYou are being called as a component of an application. Do not ask questions, do not use tools other than reading the provided image files, and answer only in the requested format.",
    ];
    if (files.length) args.push("--allowedTools", "Read", "--add-dir", dir);
    else args.push("--disallowedTools", "Bash,Edit,Write,Read,WebFetch,WebSearch,Glob,Grep,Task");
    if (MODEL) args.push("--model", MODEL);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    const started = Date.now();
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn("claude", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`model call ${req.op} timed out`));
      }, TIMEOUT_MS);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
        else resolve(out);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
    const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean; subtype?: string };
    console.log(`[model] ${req.op} ${((Date.now() - started) / 1000).toFixed(1)}s ${parsed.subtype ?? ""}`);
    if (parsed.is_error || typeof parsed.result !== "string") {
      throw new Error(`model error in ${req.op}: ${parsed.subtype ?? "unknown"} ${String(parsed.result ?? "").slice(0, 300)}`);
    }
    return parsed.result;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Extract the first JSON object/array from model text (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in model output");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Extract an HTML document from model text. */
export function extractHtml(text: string): string {
  const fence = text.match(/```html\s*([\s\S]*?)```/i);
  const html = (fence ? fence[1] : text).trim();
  const start = html.search(/<!doctype html|<html/i);
  const out = start >= 0 ? html.slice(start) : html;
  if (!/<\/html>/i.test(out) || !/<body/i.test(out)) throw new Error("model output is not a complete HTML document");
  return out;
}

export function extractSvg(text: string): string {
  const m = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new Error("model output contains no <svg> element");
  if (/<script/i.test(m[0])) throw new Error("replacement SVG must not contain scripts");
  return m[0];
}
