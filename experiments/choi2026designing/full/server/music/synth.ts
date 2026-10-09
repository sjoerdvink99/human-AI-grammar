// Deterministic renderer for model_2's score: score -> mixed audio + vocal stem.
import { chordToMidi, degreeToMidi, midiToHz, type Score } from "./score.ts";

export const SAMPLE_RATE = 22050;

export interface RenderResult {
  mix: Float32Array;
  vocal: Float32Array;
  sampleRate: number;
  duration: number;
  /** ground truth of what was sung when (kept for tests only; the analysis tools do not read it) */
  sung: { word: string; start: number; end: number }[];
}

// small deterministic PRNG so renders are reproducible
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class Biquad {
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  static bandpass(freq: number, q: number, sr: number) {
    const f = new Biquad();
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    f.b0 = alpha / a0; f.b1 = 0; f.b2 = -alpha / a0;
    f.a1 = (-2 * Math.cos(w)) / a0; f.a2 = (1 - alpha) / a0;
    return f;
  }
  static lowpass(freq: number, q: number, sr: number) {
    const f = new Biquad();
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    f.b0 = (1 - cos) / 2 / a0; f.b1 = (1 - cos) / a0; f.b2 = (1 - cos) / 2 / a0;
    f.a1 = (-2 * cos) / a0; f.a2 = (1 - alpha) / a0;
    return f;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const VOWEL_FORMANTS: Record<string, [number, number, number]> = {
  a: [800, 1150, 2900],
  e: [450, 1800, 2600],
  i: [330, 2100, 2900],
  o: [480, 820, 2600],
  u: [340, 700, 2500],
};
function vowelOf(word: string): [number, number, number] {
  const m = word.toLowerCase().match(/[aeiou]/);
  if (!m) return word.toLowerCase().includes("y") ? VOWEL_FORMANTS.i : VOWEL_FORMANTS.a;
  return VOWEL_FORMANTS[m[0]];
}

export function renderScore(score: Score, seed = 1): RenderResult {
  const sr = SAMPLE_RATE;
  const beat = 60 / score.bpm;
  const bar = beat * 4;
  const rand = rng(seed);

  // ---- lay out sections in time ----
  type Placed = { start: number; bars: number; chords: string[]; energy: number; notes: { word: string; midi: number; start: number; dur: number }[] };
  const placed: Placed[] = [];
  let t = 0.25; // small lead-in
  const vocalBase = score.vocalRegister === "high" ? 60 : 48;
  for (const sec of score.arrangement) {
    const notes: Placed["notes"] = [];
    let secBars = 0;
    if (sec.lines.length === 0) {
      secBars = 4;
    } else {
      for (const line of sec.lines) {
        const total = line.notes.reduce((a, n) => a + n.beats, 0);
        const lineBars = Math.max(2, Math.ceil((total + 0.5) / 4));
        let nt = t + secBars * bar + 0.5 * beat; // pickup after half a beat
        for (const n of line.notes) {
          const dur = n.beats * beat;
          notes.push({ word: n.word, midi: degreeToMidi(n.degree, score.key, score.mode, vocalBase), start: nt, dur });
          nt += dur;
        }
        secBars += lineBars;
      }
    }
    placed.push({ start: t, bars: secBars, chords: sec.chords.length ? sec.chords : ["I"], energy: sec.energy, notes });
    t += secBars * bar;
  }
  const duration = t + 2.5; // tail for reverb/decay
  const n = Math.ceil(duration * sr);
  const mix = new Float32Array(n);
  const vocal = new Float32Array(n);
  const has = (i: string) => score.instruments.includes(i as Score["instruments"][number]);

  const add = (buf: Float32Array, start: number, data: (i: number, tt: number) => number, len: number) => {
    const s0 = Math.floor(start * sr);
    const count = Math.floor(len * sr);
    for (let i = 0; i < count && s0 + i < buf.length; i++) {
      if (s0 + i >= 0) buf[s0 + i] += data(i, i / sr);
    }
  };

  // ---- instruments ----
  const piano = (midi: number, start: number, dur: number, amp: number) => {
    const f = midiToHz(midi);
    const len = Math.min(dur + 0.4, 3);
    add(mix, start, (_i, tt) => {
      const env = Math.exp(-tt * 2.2) * Math.min(1, tt * 200) * (tt > dur ? Math.exp(-(tt - dur) * 12) : 1);
      return amp * env * (Math.sin(2 * Math.PI * f * tt) + 0.4 * Math.sin(4 * Math.PI * f * tt) + 0.15 * Math.sin(6 * Math.PI * f * tt));
    }, len);
  };
  const pluck = (midi: number, start: number, amp: number) => {
    // Karplus-Strong
    const f = midiToHz(midi);
    const period = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = rand() * 2 - 1;
    let idx = 0;
    add(mix, start, () => {
      const next = (ring[idx] + ring[(idx + 1) % period]) * 0.4985;
      const out = ring[idx];
      ring[idx] = next;
      idx = (idx + 1) % period;
      return amp * out;
    }, 2.0);
  };
  const pad = (midis: number[], start: number, dur: number, amp: number, vibrato: boolean, bright: number) => {
    const lp = Biquad.lowpass(900 + bright * 1800, 0.7, sr);
    const phases = midis.flatMap(() => [0, 0]);
    add(mix, start, (_i, tt) => {
      const env = Math.min(1, tt / 0.35) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.5) : 1);
      let s = 0;
      midis.forEach((m, k) => {
        const vib = vibrato ? 1 + 0.003 * Math.sin(2 * Math.PI * 5.2 * tt) : 1;
        for (let d = 0; d < 2; d++) {
          const f = midiToHz(m) * (d === 0 ? 0.997 : 1.003) * vib;
          phases[k * 2 + d] = (phases[k * 2 + d] + f / sr) % 1;
          s += phases[k * 2 + d] * 2 - 1;
        }
      });
      return amp * env * lp.run(s / (midis.length * 2));
    }, dur + 0.5);
  };
  const bass = (midi: number, start: number, dur: number, amp: number) => {
    const f = midiToHz(midi);
    add(mix, start, (_i, tt) => {
      const env = Math.min(1, tt * 150) * Math.exp(-tt * 1.2) * (tt > dur ? Math.exp(-(tt - dur) * 30) : 1);
      return amp * env * (Math.sin(2 * Math.PI * f * tt) + 0.25 * Math.sin(4 * Math.PI * f * tt));
    }, dur + 0.15);
  };
  const bell = (midi: number, start: number, amp: number) => {
    const f = midiToHz(midi);
    add(mix, start, (_i, tt) => amp * Math.exp(-tt * 3) * Math.sin(2 * Math.PI * f * tt + 1.5 * Math.exp(-tt * 4) * Math.sin(2 * Math.PI * f * 3.5 * tt)), 1.5);
  };
  const kick = (start: number, amp: number) =>
    add(mix, start, (_i, tt) => amp * Math.exp(-tt * 18) * Math.sin(2 * Math.PI * (45 * tt + (110 / 25) * (1 - Math.exp(-tt * 25)))), 0.35);
  const snare = (start: number, amp: number) =>
    add(mix, start, (_i, tt) => amp * Math.exp(-tt * 22) * ((rand() * 2 - 1) * 0.8 + 0.3 * Math.sin(2 * Math.PI * 190 * tt)), 0.25);
  const hat = (start: number, amp: number) => {
    let prev = 0;
    add(mix, start, (_i, tt) => {
      const w = rand() * 2 - 1;
      const hp = w - prev;
      prev = w;
      return amp * Math.exp(-tt * 60) * hp;
    }, 0.08);
  };

  // ---- vocal (formant synthesis) ----
  const tone = { soft: 0.6, warm: 0.5, bright: 1.0, airy: 0.7 }[score.vocalTone];
  const breath = score.vocalTone === "airy" ? 0.25 : 0.06;
  const sung: RenderResult["sung"] = [];
  const voice = (word: string, midi: number, start: number, dur: number) => {
    const f0 = midiToHz(midi);
    const [f1, f2, f3] = vowelOf(word);
    const bp = [Biquad.bandpass(f1, 6, sr), Biquad.bandpass(f2, 8, sr), Biquad.bandpass(f3 * (0.9 + tone * 0.1), 10, sr)];
    const gains = [1, 0.55 * tone + 0.2, 0.25 * tone];
    const consonant = /^[^aeiou]/i.test(word);
    const sing = Math.max(0.08, dur - 0.06);
    let ph = 0;
    sung.push({ word, start, end: start + sing });
    add(vocal, start, (_i, tt) => {
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / 0.3);
      ph = (ph + (f0 * vib) / sr) % 1;
      const src = (ph * 2 - 1) + breath * (rand() * 2 - 1);
      let s = 0;
      for (let k = 0; k < 3; k++) s += gains[k] * bp[k].run(src);
      const attack = Math.min(1, tt / 0.035);
      const release = tt > sing - 0.05 ? Math.max(0, (sing - tt) / 0.05) : 1;
      let out = 0.9 * s * attack * release;
      if (consonant && tt < 0.04) out += 0.12 * (rand() * 2 - 1) * (1 - tt / 0.04);
      return out;
    }, sing);
  };

  // ---- arrangement ----
  for (const sec of placed) {
    const amp = 0.35 + 0.65 * sec.energy;
    for (let b = 0; b < sec.bars; b++) {
      const bs = sec.start + b * bar;
      const chord = chordToMidi(sec.chords[b % sec.chords.length], score.key, score.mode, 48);
      if (has("synth pad")) pad(chord.map((m) => m + 12), bs, bar, 0.16 * amp, false, sec.energy);
      if (has("strings")) pad(chord, bs, bar, 0.13 * amp, true, 0.3);
      if (has("piano")) {
        if (sec.energy > 0.55) for (let q = 0; q < 4; q++) chord.forEach((m) => piano(m + 12, bs + q * beat, beat, 0.05 * amp));
        else chord.forEach((m, k) => piano(m + 12, bs + k * beat * 0.5, bar, 0.07 * amp));
      }
      if (has("acoustic guitar")) {
        const strum = [0, 1, 1.5, 2.5, 3];
        strum.forEach((p, k) => chord.forEach((m, j) => pluck(m + 12, bs + p * beat + j * 0.012, (k === 0 ? 0.12 : 0.07) * amp)));
      }
      if (has("bass")) {
        bass(chord[0] - 12, bs, beat * 2, 0.32 * amp);
        bass(chord[0] - 12 + (b % 2 ? 7 : 0), bs + 2 * beat, beat * 2, 0.28 * amp);
      }
      if (has("bells") && b % 2 === 0) chord.forEach((m, k) => bell(m + 24, bs + k * beat, 0.05 * amp));
      if (has("drums") && score.drumPattern !== "none" && (sec.notes.length > 0 || sec.energy > 0.5)) {
        const sw = score.swing ? beat * 0.16 : 0;
        const p = score.drumPattern;
        if (p === "soft") {
          kick(bs, 0.5 * amp);
          kick(bs + 2 * beat, 0.4 * amp);
          for (let q = 0; q < 4; q++) hat(bs + q * beat, 0.15 * amp);
        } else if (p === "halftime") {
          kick(bs, 0.7 * amp);
          kick(bs + 1.5 * beat, 0.4 * amp);
          snare(bs + 2 * beat, 0.45 * amp);
          for (let q = 0; q < 8; q++) hat(bs + q * beat * 0.5 + (q % 2 ? sw : 0), 0.18 * amp);
        } else {
          const hard = p === "driving" ? 1.2 : 1;
          kick(bs, 0.75 * amp * hard);
          kick(bs + 2 * beat, 0.65 * amp * hard);
          if (p === "driving") kick(bs + 2.5 * beat, 0.5 * amp);
          snare(bs + beat, 0.45 * amp * hard);
          snare(bs + 3 * beat, 0.45 * amp * hard);
          for (let q = 0; q < 8; q++) hat(bs + q * beat * 0.5 + (q % 2 ? sw : 0), 0.2 * amp);
        }
      }
    }
    for (const nt of sec.notes) voice(nt.word, nt.midi, nt.start, nt.dur);
  }

  // ---- mix + normalise ----
  let peakV = 0;
  for (let i = 0; i < n; i++) peakV = Math.max(peakV, Math.abs(vocal[i]));
  const vg = peakV > 0 ? 0.55 / peakV : 0;
  for (let i = 0; i < n; i++) {
    vocal[i] *= vg;
    mix[i] = mix[i] * 0.8 + vocal[i];
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const g = peak > 0 ? 0.92 / peak : 1;
  for (let i = 0; i < n; i++) mix[i] = Math.tanh(mix[i] * g * 1.1) * 0.9;
  return { mix, vocal, sampleRate: sr, duration, sung };
}
