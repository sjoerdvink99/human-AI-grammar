/** tool_4 extract: song → beat_features (table: beat, time, strength, energy, downbeat). */
import type { BeatRow } from '../types.ts';
import { frameRms, HOP, onsetEnvelope } from './dsp.ts';

/** STFT frames see an onset before their centre; shift frame times to the onset. */
const ONSET_LAG = 0.07;

export function estimateTempo(env: Float64Array, sampleRate: number): number {
  const fps = sampleRate / HOP;
  let best = 0, bestBpm = 100;
  for (let bpm = 50; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < env.length; i++) s += env[i] * (env[i + l0] * (1 - fr) + env[i + l0 + 1] * fr);
    s /= env.length - l0;
    // prefer musically common tempi (log-gaussian around 110 bpm)
    s *= Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    if (s > best) { best = s; bestBpm = bpm; }
  }
  return bestBpm;
}

export function extractBeats(x: Float32Array, sampleRate: number): BeatRow[] {
  const env = onsetEnvelope(x);
  const rms = frameRms(x);
  const rmsMax = Math.max(1e-9, ...rms);
  const fps = sampleRate / HOP;
  const bpm = estimateTempo(env, sampleRate);
  const period = (60 / bpm) * fps;
  // phase: offset that maximises onset strength on the first 8 beats of the grid
  let bestPhase = 0, bestSum = -1;
  for (let p = 0; p < period; p++) {
    let s = 0;
    for (let k = 0; k < 8; k++) s += env[Math.round(p + k * period)] ?? 0;
    if (s > bestSum) { bestSum = s; bestPhase = p; }
  }
  // track: each beat is predicted from the previous one and snapped to the local onset maximum
  const beats: { frame: number; strength: number }[] = [];
  const w = Math.max(1, Math.round(period * 0.12));
  for (let f = bestPhase; f < env.length; ) {
    let bf = Math.round(f);
    for (let k = Math.round(f) - w; k <= Math.round(f) + w; k++) if ((env[k] ?? -1) > (env[bf] ?? -1) * 1.15) bf = k;
    beats.push({ frame: bf, strength: env[bf] ?? 0 });
    f = (env[bf] ?? 0) > 0.1 ? bf + period : f + period; // only re-anchor on clear onsets
  }
  // downbeat phase: the beat-in-bar position (0..3) with the strongest mean onset
  const bin = [0, 0, 0, 0];
  beats.forEach((b, i) => (bin[i % 4] += b.strength));
  const down = bin.indexOf(Math.max(...bin));
  return beats.map((b, i) => ({
    beat: i + 1,
    time: +(b.frame / fps + ONSET_LAG).toFixed(3),
    strength: +b.strength.toFixed(3),
    energy: +((rms[Math.min(rms.length - 1, b.frame)] ?? 0) / rmsMax).toFixed(3),
    downbeat: i % 4 === down,
  }));
}
