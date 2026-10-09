// tool_4 extract — beat analysis.
// song (+ timed_lyrics + audio_features carried along) -> beat_features (table of beat times)
// Onset-strength envelope (spectral flux) -> tempo by autocorrelation ->
// dynamic-programming beat tracker -> downbeat phase from low-frequency onsets.
import { join } from "node:path";
import { readWav } from "../music/wav.ts";
import { magnitudeSpectrum } from "./dsp.ts";
import { AUDIO_DIR } from "../store.ts";
import type { BeatFeatures, BeatRow } from "../types.ts";

export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop = 512, size = 1024) {
  const env: number[] = [];
  const low: number[] = [];
  let prev: Float64Array | null = null;
  const lowBin = Math.ceil((150 * size) / sampleRate);
  for (let s = 0; s + size <= samples.length; s += hop) {
    const mag = magnitudeSpectrum(samples, s, size);
    const logMag = mag.map((m) => Math.log1p(100 * m));
    let flux = 0, lowFlux = 0;
    if (prev) {
      for (let k = 1; k < logMag.length; k++) {
        const d = Math.max(0, logMag[k] - prev[k]);
        flux += d;
        if (k <= lowBin) lowFlux += d;
      }
    }
    env.push(flux);
    low.push(lowFlux);
    prev = logMag;
  }
  // remove local mean
  const w = 8;
  const out = env.map((v, i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - w); k < Math.min(env.length, i + w); k++) { s += env[k]; c++; }
    return Math.max(0, v - s / c);
  });
  const mean = out.reduce((a, b) => a + b, 0) / Math.max(1, out.length);
  const sd = Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, out.length)) || 1;
  return { env: out.map((v) => v / sd), low, fps: sampleRate / hop };
}

export function estimateTempo(env: number[], fps: number): number {
  let best = 0, bestLag = 0;
  const minLag = Math.floor((60 / 180) * fps);
  const maxLag = Math.ceil((60 / 55) * fps);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    if (s * prior > best) { best = s * prior; bestLag = lag; }
  }
  return bestLag ? (60 * fps) / bestLag : 100;
}

export function trackBeats(env: number[], fps: number, tempo: number, tightness = 100): number[] {
  const period = (60 * fps) / tempo;
  const n = env.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bi = -1;
    for (let p = i - Math.round(2 * period); p <= i - Math.round(period / 2); p++) {
      if (p < 0) continue;
      const pen = -tightness * Math.log((i - p) / period) ** 2;
      if (score[p] + pen > best) { best = score[p] + pen; bi = p; }
    }
    score[i] = env[i] + (bi >= 0 ? best : 0);
    back[i] = bi;
  }
  let i = 0;
  const tail = Math.max(0, n - Math.round(period));
  for (let k = tail; k < n; k++) if (score[k] > score[i] || i < tail) i = k;
  const beats: number[] = [];
  while (i >= 0) { beats.push(i); i = back[i]; }
  return beats.reverse();
}

export function extractBeatsFromSamples(samples: Float32Array, sampleRate: number): BeatFeatures {
  const { env, low, fps } = onsetEnvelope(samples, sampleRate);
  const tempo = estimateTempo(env, fps);
  const frames = trackBeats(env, fps, tempo);
  const maxE = Math.max(...frames.map((f) => env[f]), 1e-9);
  // downbeat phase: the phase (mod 4) with most low-frequency (kick/bass) onset energy
  const phaseScore = [0, 0, 0, 0];
  frames.forEach((f, k) => (phaseScore[k % 4] += low[f] ?? 0));
  const phase = phaseScore.indexOf(Math.max(...phaseScore));
  const rows: BeatRow[] = frames.map((f, k) => ({
    index: k,
    time: +(f / fps).toFixed(3),
    strength: +(env[f] / maxE).toFixed(3),
    downbeat: k % 4 === phase,
  }));
  return { tempo: +tempo.toFixed(1), rows };
}

export function extractBeats(songFile: string): BeatFeatures {
  const { samples, sampleRate } = readWav(join(AUDIO_DIR, songFile));
  return extractBeatsFromSamples(samples, sampleRate);
}
