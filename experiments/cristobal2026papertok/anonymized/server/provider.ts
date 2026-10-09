/**
 * Model provider. Every model step in the design goes through this file:
 *   model_1 (language)  -> callModel / callModelJSON
 *   model_2 (image)     -> generateImage
 *   model_3 (speech)    -> synthesizeSpeech
 * Swap the implementations here to change provider.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ZodType } from "zod";

const MODEL = process.env.CLAUDE_MODEL || ""; // empty = CLI default
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 240_000);

export interface ModelRequest {
  system: string;
  prompt: string;
}

/** The single swap point for text generation. Calls the local Claude Code CLI. */
export async function callModel({ system, prompt }: ModelRequest): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = [
    "-p",
    "--output-format",
    "json",
    "--system-prompt",
    system,
    "--tools",
    "",
    "--no-session-persistence",
  ];
  if (MODEL) args.push("--model", MODEL);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { env, cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Model call timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
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
        if (parsed.is_error || typeof parsed.result !== "string") {
          reject(new Error(`Model error: ${parsed.result ?? parsed.subtype ?? "unknown"}`));
        } else resolve(parsed.result);
      } catch {
        reject(new Error(`claude CLI exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Pull the first JSON object/array out of a model reply. */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error("Unterminated JSON in model output");
  return JSON.parse(body.slice(start, end + 1));
}

/** Structured output: ask for JSON, validate with zod, retry once with the validation error. */
export async function callModelJSON<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
  let prompt = req.prompt;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel({ system: req.system + "\nRespond with JSON only, no prose.", prompt });
    try {
      return schema.parse(extractJSON(raw));
    } catch (e) {
      lastErr = e;
      prompt = `${req.prompt}\n\nYour previous reply was invalid (${String(e).slice(0, 600)}). Reply again with valid JSON that matches the requested shape exactly.`;
    }
  }
  throw new Error(`Model output failed validation: ${String(lastErr).slice(0, 400)}`);
}

// ---------- model_2: image generation ----------

const IMAGE_SYSTEM = `You are an illustrator for short educational explainer videos.
You draw a single self-contained SVG illustration for one scene.
Rules:
- Output exactly one <svg> element with xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 1280 720", nothing else.
- Flat, clean infographic style: simple shapes, icons, arrows, diagrams, a coherent palette with a light background.
- At most 8 short text labels (max 4 words each), font-family sans-serif, large enough to read (>= 28px). Do not write the narration on the image.
- No <script>, no <foreignObject>, no external images, links, or fonts, no animation.`;

export function sanitizeSVG(raw: string): string {
  const m = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new Error("Image model did not return an <svg> element");
  let svg = m[0];
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "");
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");
  svg = svg.replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "");
  if (!/xmlns=/.test(svg.slice(0, 300))) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/i.test(svg.slice(0, 400))) svg = svg.replace(/<svg/i, '<svg viewBox="0 0 1280 720"');
  // fix width/height so it rasterises at a known size
  svg = svg.replace(/<svg([^>]*)>/i, (_all, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return `<svg${cleaned} width="1280" height="720">`;
  });
  return svg;
}

/** model_2 generate: visual prompt -> SVG image markup. */
export async function generateImage(visualPrompt: string, styleNote: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel({
      system: IMAGE_SYSTEM,
      prompt: `Visual style for the whole video: ${styleNote}\n\nDraw this scene:\n${visualPrompt}${
        attempt ? "\n\n(Variation: try a different composition.)" : ""
      }`,
    });
    try {
      return sanitizeSVG(raw);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- model_3: speech synthesis ----------

export const VOICE_CANDIDATES = [
  "Samantha",
  "Samantha (English (US))",
  "Daniel",
  "Karen",
  "Moira",
  "Tessa",
  "Rishi",
  "Reed (English (US))",
  "Flo (English (US))",
  "Shelley (English (US))",
];

let voiceCache: string[] | null = null;
export async function availableVoices(): Promise<string[]> {
  if (voiceCache) return voiceCache;
  const list = await new Promise<string>((resolve) => {
    const c = spawn("say", ["-v", "?"]);
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("close", () => resolve(o));
    c.on("error", () => resolve(""));
  });
  const names = list.split("\n").map((l) => l.match(/^(.+?)\s+[a-z]{2,3}_[A-Za-z0-9]+\s+#/)?.[1].trim() ?? "");
  voiceCache = VOICE_CANDIDATES.filter((v) => names.includes(v));
  return voiceCache;
}

/**
 * model_3 generate: narration text + voice -> WAV bytes.
 * The Claude CLI cannot emit audio, so this uses the macOS speech synthesizer.
 */
export async function synthesizeSpeech(text: string, voice: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tts-"));
  const inFile = path.join(dir, "in.txt");
  const outFile = path.join(dir, "out.wav");
  await writeFile(inFile, text, "utf8");
  await new Promise<void>((resolve, reject) => {
    const c = spawn("say", ["-v", voice, "-f", inFile, "-o", outFile, "--file-format=WAVE", "--data-format=LEI16@22050"]);
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`say failed: ${err}`))));
  });
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(outFile);
  await rm(dir, { recursive: true, force: true });
  return buf;
}
