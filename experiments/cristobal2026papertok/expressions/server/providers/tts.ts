import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RegenerationRequest } from "../types.ts";

const run = promisify(execFile);

export interface SpeechRequest {
  text: string;
  /** (voice_style_1: instruction language) */
  voiceStyle: string;
  /** optional variation from (regeneration_request_1: instruction categorical) */
  variation?: RegenerationRequest;
  outFile: string;
}

/** Map a free-text voice style onto the parameters the local synthesiser understands. */
export function voiceParams(voiceStyle: string, variation?: RegenerationRequest) {
  const s = voiceStyle.toLowerCase();
  let rate = 180;
  if (/\b(energetic|fast|upbeat|excited|enthusiastic|punchy|brisk|lively)\b/.test(s)) rate += 20;
  if (/\b(calm|slow|measured|soothing|gentle|relaxed|deliberate)\b/.test(s)) rate -= 20;
  if (variation === "more_energetic") rate += 25;
  if (variation === "calmer") rate -= 25;
  let voice = "Samantha";
  if (/\b(male|man|deep|baritone)\b/.test(s) && !/\bfemale\b/.test(s)) voice = "Daniel";
  if (/\b(british|uk)\b/.test(s)) voice = /\bfemale\b/.test(s) ? "Kate" : "Daniel";
  return { voice, rate: Math.max(130, Math.min(240, rate)) };
}

/**
 * model_3 generate~ : narration audio for one scene.
 * Current provider: macOS `say` (WAV, 22.05 kHz mono). Swap this body for a neural TTS API.
 */
export async function synthesizeSpeech(req: SpeechRequest): Promise<void> {
  const { voice, rate } = voiceParams(req.voiceStyle, req.variation);
  const args = ["--file-format=WAVE", "--data-format=LEI16@22050", "-r", String(rate), "-o", req.outFile, req.text];
  try {
    await run("say", ["-v", voice, ...args]);
  } catch {
    await run("say", args); // voice not installed: fall back to the system voice
  }
}
