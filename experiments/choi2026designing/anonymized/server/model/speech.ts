// model_2 — the speech model. P3/P5 [model_2 generate]~: r14 voice direction (+ r10 script) → r15 audio.
//
// No speech-synthesis API is available, so the default speech provider is a separate model_2 configuration
// of the Claude CLI. It turns the voice direction into a performance script in macOS `say` markup
// (rate, pitch, silence and emphasis commands), and the local `say` engine renders it to WAV.
// Before rendering, the markup is checked to make sure it reproduces the script's words exactly;
// if it does not, the script is rendered plainly. Swap `speechProvider` for a real TTS model.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { callModel } from "./provider.ts";
import { num, obj, str } from "./validate.ts";

const run = promisify(execFile);
export const AUDIO_DIR = path.resolve(process.env.AUDIO_DIR ?? "data/audio");
mkdirSync(AUDIO_DIR, { recursive: true });

export interface SpeechResult {
  file: string; // absolute path of the WAV file
  url: string; // URL the web app plays it from
  fallback: boolean;
}

export type SpeechProvider = (direction: string, script: string, voices: string[]) => Promise<SpeechResult>;

let voiceCache: string[] | null = null;
export async function listVoices(): Promise<string[]> {
  if (voiceCache) return voiceCache;
  try {
    const { stdout } = await run("say", ["-v", "?"]);
    voiceCache = stdout
      .split("\n")
      .map((l) => l.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/))
      .filter((m): m is RegExpMatchArray => !!m && m[2].startsWith("en_"))
      .map((m) => m[1].trim())
      .filter((v) => !/^(Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox)$/.test(v));
  } catch {
    voiceCache = [];
  }
  voiceCache = [...new Set(voiceCache)];
  if (!voiceCache.length) voiceCache = ["Samantha"];
  return voiceCache;
}

/** Normalised word sequence, ignoring say commands and punctuation. */
export function spokenWords(text: string): string[] {
  return text
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Only allow the documented, harmless say commands in the markup. */
export function sanitizeMarkup(markup: string): string {
  return markup.replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => {
    const c = inner.trim().match(/^(rate|pbas|pmod|volm|slnc|emph)\s+([+-]?\d+(\.\d+)?|[+-])$/);
    return c ? `[[${c[1]} ${c[2]}]]` : " ";
  });
}

export const sayProvider: SpeechProvider = async (direction, script, voices) => {
  const plan = await callModel(
    {
      role: "model_2",
      operation: "synthesizeSpeech",
      system:
        "You are a speech-synthesis performance engine. You convert a voice direction and a script into marked-up text for the macOS speech synthesizer. Answer only with the JSON requested.",
      prompt:
        `Voice direction:\n"""\n${direction}\n"""\n\nScript:\n"""\n${script}\n"""\n\n` +
        `Available voices: ${voices.join(", ")}.\n\n` +
        `Return: voice (one of the available voices, matching the direction), rate (words per minute, 90-300), and markup: ` +
        `the COMPLETE script, word for word, with no words added, removed or changed, with embedded commands inserted between words: ` +
        `[[rate N]] to change pace locally, [[pbas N]] for base pitch (30-70, 50 = normal), [[pmod N]] for pitch variation (0-100), ` +
        `[[slnc N]] for N milliseconds of silence, [[emph +]] placed directly before a word to stress it. Use commands to realise the direction.`,
      schema: {
        type: "object",
        properties: { voice: { type: "string" }, rate: { type: "number" }, markup: { type: "string" } },
        required: ["voice", "rate", "markup"],
      },
    },
    (raw) => {
      const o = obj(raw, "speech");
      return { voice: str(o.voice, "voice"), rate: Math.round(num(o.rate, "rate", 90, 300)), markup: str(o.markup, "markup") };
    },
  );
  const known = (v: string) => voices.includes(v) || voices.some((x) => x.startsWith(`${v} (`));
  const voice = known(plan.voice) ? plan.voice : voices[0];
  const markup = sanitizeMarkup(plan.markup);
  const same = spokenWords(markup).join(" ") === spokenWords(script).join(" ");
  const text = same ? markup : script;
  if (!same) console.warn("[model_2 synthesizeSpeech] markup changed the script's words; rendering plain script");
  const id = randomUUID();
  const file = path.join(AUDIO_DIR, `${id}.wav`);
  await run("say", ["-v", voice, "-r", String(plan.rate), "-o", file, "--data-format=LEI16@22050", text], {
    maxBuffer: 1 << 20,
  });
  return { file, url: `/audio/${id}.wav`, fallback: !same };
};

let speechProvider: SpeechProvider = sayProvider;
export function setSpeechProvider(p: SpeechProvider) {
  speechProvider = p;
}

export async function synthesizeSpeech(direction: string, script: string): Promise<SpeechResult> {
  return speechProvider(direction, script, await listVoices());
}
