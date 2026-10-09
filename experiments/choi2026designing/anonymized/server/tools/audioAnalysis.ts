// P3/P5 [tool_2 extract]: r15 audio → r16 voiced segments + r17 prosody contour.
import { readFileSync } from "node:fs";
import type { ProsodyFrame, Segment } from "../../shared/types.ts";

export interface PcmAudio {
  sampleRate: number;
  samples: Float32Array; // mono, -1..1
}

/** Minimal RIFF/WAV reader for 16-bit PCM (mono or stereo). */
export function decodeWav(buf: Buffer): PcmAudio {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let off = 12;
  let channels = 1;
  let sampleRate = 22050;
  let bits = 16;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`unsupported bit depth ${bits}`);
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += buf.readInt16LE(body + 2 * (i * channels + c));
        samples[i] = s / channels / 32768;
      }
      return { sampleRate, samples };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

const FRAME_S = 0.02; // 20 ms hop
const WIN_S = 0.04; // 40 ms window

/** Autocorrelation pitch estimate for one window (75–400 Hz), or null when unvoiced. */
export function estimatePitch(win: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.min(win.length - 1, Math.floor(sampleRate / 75));
  let energy = 0;
  for (let i = 0; i < win.length; i++) energy += win[i] * win[i];
  if (energy <= 1e-6) return null;
  let bestLag = -1;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = 0; i + lag < win.length; i++) r += win[i] * win[i + lag];
    r /= energy;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return best > 0.45 && bestLag > 0 ? sampleRate / bestLag : null;
}

export function prosodyContour(audio: PcmAudio): ProsodyFrame[] {
  const { samples, sampleRate } = audio;
  const hop = Math.round(FRAME_S * sampleRate);
  const win = Math.round(WIN_S * sampleRate);
  const frames: ProsodyFrame[] = [];
  for (let start = 0; start + win <= samples.length; start += hop) {
    const w = samples.subarray(start, start + win);
    let sum = 0;
    for (let i = 0; i < w.length; i++) sum += w[i] * w[i];
    const rms = Math.sqrt(sum / w.length);
    const rmsDb = Math.max(-80, 20 * Math.log10(rms + 1e-9));
    frames.push({ t: +(start / sampleRate + WIN_S / 2).toFixed(3), pitchHz: rmsDb > -40 ? estimatePitch(w, sampleRate) : null, rmsDb: +rmsDb.toFixed(1) });
  }
  // Median-smooth pitch to remove octave jumps.
  return frames.map((f, i) => {
    if (f.pitchHz === null) return f;
    const nb = frames.slice(Math.max(0, i - 2), i + 3).map((x) => x.pitchHz).filter((p): p is number => p !== null).sort((a, b) => a - b);
    return { ...f, pitchHz: +nb[Math.floor(nb.length / 2)].toFixed(1) };
  });
}

/** Speech segments: runs of frames above an adaptive loudness threshold, split by pauses ≥ minPause. */
export function detectSegments(frames: ProsodyFrame[], minPause = 0.12, minSegment = 0.06): Segment[] {
  if (!frames.length) return [];
  const sorted = frames.map((f) => f.rmsDb).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[Math.floor(sorted.length * 0.95)];
  const threshold = Math.max(floor + 0.25 * (peak - floor), -50);
  const raw: Segment[] = [];
  let cur: Segment | null = null;
  for (const f of frames) {
    const on = f.rmsDb >= threshold;
    if (on && !cur) cur = { start: f.t - FRAME_S / 2, end: f.t + FRAME_S / 2 };
    else if (on && cur) cur.end = f.t + FRAME_S / 2;
    else if (!on && cur && f.t - cur.end >= minPause) {
      raw.push(cur);
      cur = null;
    }
  }
  if (cur) raw.push(cur);
  // Merge segments separated by short gaps, then drop blips.
  const merged: Segment[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < minPause) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged
    .filter((s) => s.end - s.start >= minSegment)
    .map((s) => ({ start: +Math.max(0, s.start).toFixed(3), end: +s.end.toFixed(3) }));
}

export function analyzeAudio(file: string): { duration: number; segments: Segment[]; prosody: ProsodyFrame[] } {
  const audio = decodeWav(readFileSync(file));
  const prosody = prosodyContour(audio);
  return { duration: audio.samples.length / audio.sampleRate, segments: detectSegments(prosody), prosody };
}
