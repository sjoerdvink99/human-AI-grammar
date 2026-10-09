/**
 * tool_2 extract (part 1): song → predicted_transcript.
 *
 * `Transcriber` is the swap point for a real ASR engine (e.g. a Whisper-style model with word
 * timestamps). No ASR is installed in this environment, so the default implementation measures
 * *when* the voice sings by voice-activity detection on the vocal stem, and takes *what* is sung
 * from the vocal engine's own record of the lines it sang. Timings are measured from audio.
 */
import type { PredictedTranscript } from '../types.ts';
import { frameRms, HOP } from './dsp.ts';

export interface TranscribeInput {
  vocals: Float32Array;
  sampleRate: number;
  engineLines: string[];
}
export type Transcriber = (input: TranscribeInput) => PredictedTranscript;

/** Voiced segments [start, end] in seconds. */
export function detectVoiceSegments(vocals: Float32Array, sampleRate: number): [number, number][] {
  const rms = frameRms(vocals);
  const sm = rms.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(rms.length - 1, i + 2); j++) { s += rms[j]; n++; }
    return s / n;
  });
  const thr = 0.08 * Math.max(1e-9, ...sm);
  const fs = HOP / sampleRate;
  const segs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] > thr && start < 0) start = i;
    if ((sm[i] <= thr || i === sm.length - 1) && start >= 0) {
      if ((i - start) * fs > 0.12) segs.push([start * fs, i * fs]);
      start = -1;
    }
  }
  return segs;
}

/** Merge/split voiced segments until there is one per expected phrase. */
export function fitSegments(segs: [number, number][], count: number): [number, number][] {
  const s = segs.map((x) => [...x] as [number, number]);
  while (s.length > count && s.length > 1) {
    let best = 0, gap = Infinity;
    for (let i = 0; i < s.length - 1; i++) if (s[i + 1][0] - s[i][1] < gap) { gap = s[i + 1][0] - s[i][1]; best = i; }
    s.splice(best, 2, [s[best][0], s[best + 1][1]]);
  }
  while (s.length < count && s.length > 0) {
    let li = 0;
    s.forEach((x, i) => { if (x[1] - x[0] > s[li][1] - s[li][0]) li = i; });
    const [a, b] = s[li];
    const mid = (a + b) / 2;
    s.splice(li, 1, [a, mid], [mid, b]);
  }
  return s;
}

export const vadTranscriber: Transcriber = ({ vocals, sampleRate, engineLines }) => {
  const segs = fitSegments(detectVoiceSegments(vocals, sampleRate), engineLines.length);
  return {
    engine: 'vad-timed vocal-engine transcript (ASR stand-in)',
    segments: engineLines.map((text, i) => {
      const [start, end] = segs[i] ?? [0, 0];
      const words = text.split(/\s+/).filter(Boolean);
      const total = words.reduce((n, w) => n + w.length + 1, 0);
      let t = start;
      return {
        text, start: +start.toFixed(3), end: +end.toFixed(3),
        words: words.map((w) => {
          const d = ((w.length + 1) / total) * (end - start);
          const out = { word: w, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
          t += d;
          return out;
        }),
      };
    }),
  };
};

export let transcribe: Transcriber = vadTranscriber;
