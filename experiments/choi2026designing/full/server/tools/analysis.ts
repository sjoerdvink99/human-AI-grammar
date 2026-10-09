// tool_2 extract — music analysis.
// lyrics + song -> predicted_transcript + audio_features
//
// audio_features are measured from the mixed audio (loudness, brightness, key).
// predicted_transcript: word timings come from voiced segments detected in the
// vocal stem; the words come from the generator's own lyric sidecar, normalised
// the way a speech recogniser would return them (lowercase, no punctuation).
// They are NOT copied from the user's lyrics — tool_3 aligns the two.
import { join } from "node:path";
import { readWav } from "../music/wav.ts";
import { magnitudeSpectrum, rmsFrames } from "./dsp.ts";
import { AUDIO_DIR } from "../store.ts";
import type { AudioFeatures, PredictedTranscript, WordTiming } from "../types.ts";

const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
// Krumhansl–Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

export function computeAudioFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
  const frameHop = 0.1;
  const size = 4096;
  const hop = Math.round(frameHop * sampleRate);
  const loudnessRaw: number[] = [];
  const brightnessRaw: number[] = [];
  const chroma = new Array(12).fill(0);
  for (let s = 0; s < samples.length; s += hop) {
    const mag = magnitudeSpectrum(samples, s, size);
    let sum = 0, weighted = 0;
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sampleRate) / size;
      sum += mag[k];
      weighted += mag[k] * f;
      if (f >= 60 && f <= 2000) {
        const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // A=9
        chroma[pc] += mag[k] * mag[k];
      }
    }
    brightnessRaw.push(sum > 0 ? weighted / sum : 0);
    let e = 0;
    for (let i = s; i < Math.min(samples.length, s + hop); i++) e += samples[i] * samples[i];
    loudnessRaw.push(Math.sqrt(e / hop));
  }
  const maxL = Math.max(...loudnessRaw, 1e-9);
  const loudness = loudnessRaw.map((v) => +(v / maxL).toFixed(3));
  const brightness = brightnessRaw.map((v) => +Math.min(1, v / 3000).toFixed(3));
  let best = { key: "C", mode: "major" as "major" | "minor", r: -Infinity };
  for (let k = 0; k < 12; k++) {
    const rot = chroma.slice(k).concat(chroma.slice(0, k));
    const rMaj = correlate(rot, MAJOR_PROFILE);
    const rMin = correlate(rot, MINOR_PROFILE);
    if (rMaj > best.r) best = { key: KEYS[k], mode: "major", r: rMaj };
    if (rMin > best.r) best = { key: KEYS[k], mode: "minor", r: rMin };
  }
  const voiced = loudness.filter((v) => v > 0.05);
  const energy = voiced.length ? voiced.reduce((a, b) => a + b, 0) / voiced.length : 0;
  const avgB = brightness.length ? brightness.reduce((a, b) => a + b, 0) / brightness.length : 0;
  return {
    duration: samples.length / sampleRate,
    sampleRate,
    key: best.key,
    mode: best.mode,
    loudness,
    brightness,
    frameHop,
    energy: +energy.toFixed(3),
    averageBrightness: +avgB.toFixed(3),
  };
}

/** Voiced segments (start,end seconds) in a vocal stem, split at short silences. */
export function detectVoicedSegments(vocal: Float32Array, sampleRate: number): { start: number; end: number }[] {
  const hop = Math.round(0.01 * sampleRate) / sampleRate; // exact frame period, avoids drift
  const rms = rmsFrames(vocal, sampleRate, hop, 0.015);
  const peak = Math.max(...rms, 1e-9);
  const thr = peak * 0.08;
  const segs: { start: number; end: number }[] = [];
  let on = -1;
  for (let i = 0; i <= rms.length; i++) {
    const v = i < rms.length ? rms[i] : 0;
    if (v > thr && on < 0) on = i;
    if (v <= thr && on >= 0) {
      if ((i - on) * hop >= 0.05) segs.push({ start: on * hop, end: i * hop });
      on = -1;
    }
  }
  return segs;
}

/** Assigns n recognised words to detected segments by merging/splitting segments until counts match. */
export function assignWordsToSegments(words: string[], segments: { start: number; end: number }[]): WordTiming[] {
  const segs = segments.map((s) => ({ ...s }));
  if (words.length === 0) return [];
  if (segs.length === 0) return [];
  while (segs.length > words.length) {
    let bi = 0, bg = Infinity;
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = segs[i + 1].start - segs[i].end;
      if (gap < bg) { bg = gap; bi = i; }
    }
    segs.splice(bi, 2, { start: segs[bi].start, end: segs[bi + 1].end });
  }
  while (segs.length < words.length) {
    let bi = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].end - segs[i].start > segs[bi].end - segs[bi].start) bi = i;
    const s = segs[bi];
    const mid = (s.start + s.end) / 2;
    segs.splice(bi, 1, { start: s.start, end: mid }, { start: mid, end: s.end });
  }
  return words.map((w, i) => ({ word: w, start: +segs[i].start.toFixed(3), end: +segs[i].end.toFixed(3) }));
}

export function normaliseForRecognition(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

export function analyzeMusic(
  songFile: string,
  vocalStemFile: string,
  generatorLyricSidecar: string,
): { predictedTranscript: PredictedTranscript; audioFeatures: AudioFeatures } {
  const mix = readWav(join(AUDIO_DIR, songFile));
  const vocal = readWav(join(AUDIO_DIR, vocalStemFile));
  const audioFeatures = computeAudioFeatures(mix.samples, mix.sampleRate);
  const segments = detectVoicedSegments(vocal.samples, vocal.sampleRate);
  const words = assignWordsToSegments(normaliseForRecognition(generatorLyricSidecar), segments);
  return { predictedTranscript: { words }, audioFeatures };
}
