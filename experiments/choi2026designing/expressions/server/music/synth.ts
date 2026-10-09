/** Deterministic renderer: Composition → PCM (instrument mix + vocal stem). */
import { KEYS, type Composition } from './composition.ts';
import { renderVocalLine } from './vocals.ts';
import { SR } from './wav.ts';

const VOICE_MAP: Record<Composition['voice'], string> = {
  'warm female': 'Samantha',
  'gentle male': 'Daniel',
  'bright female': 'Karen',
  'soft female': 'Moira',
  'deep male': 'Ralph',
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const NUMERAL_ROOT: Record<string, number> = { I: 0, i: 0, ii: 2, iii: 4, bIII: 3, IV: 5, iv: 5, V: 7, v: 7, vi: 9, bVI: 8, bVII: 10 };

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function chordNotes(keyPc: number, numeral: string): number[] {
  const root = keyPc + (NUMERAL_ROOT[numeral] ?? 0);
  const minor = numeral.replace('b', '')[0] === numeral.replace('b', '')[0].toLowerCase();
  return [root, root + (minor ? 3 : 4), root + 7];
}

function scaleDegreeToMidi(keyPc: number, mode: 'major' | 'minor', degree: number): number {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const d = degree - 1;
  return 60 + keyPc + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
}

/** Simple seeded PRNG so a given composition always renders identically. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export interface RenderedSong {
  mix: Float32Array;
  vocals: Float32Array;
  /** Lines in the order the vocal engine sang them (the engine's own record). */
  sung: { text: string; section: string }[];
  bpm: number;
}

export async function renderComposition(c: Composition): Promise<RenderedSong> {
  const keyPc = KEYS.indexOf(c.key);
  const beat = 60 / c.bpm;
  const bar = beat * 4;
  const BARS_PER_LINE = 2;
  const totalBars = c.intro_bars + c.outro_bars + c.sections.reduce((n, s) => n + s.lines.length * BARS_PER_LINE, 0);
  const total = Math.ceil((totalBars * bar + 3) * SR);
  const music = new Float32Array(total);
  const vocals = new Float32Array(total);
  const rand = rng(c.bpm * 31 + keyPc);
  const has = (i: string) => c.instruments.includes(i as never);

  const add = (buf: Float32Array, start: number, data: Float32Array | ((i: number) => number), len?: number) => {
    const s0 = Math.floor(start * SR);
    const n = typeof data === 'function' ? len! : data.length;
    for (let i = 0; i < n && s0 + i < buf.length; i++) buf[s0 + i] += typeof data === 'function' ? data(i) : data[i];
  };

  const tone = (t0: number, dur: number, hz: number, amp: number, kind: 'pad' | 'piano' | 'synth' | 'lead' | 'bass') => {
    const n = Math.floor(dur * SR);
    const atk = kind === 'pad' ? 0.25 * SR : kind === 'synth' ? 0.05 * SR : 0.005 * SR;
    add(music, t0, (i) => {
      const t = i / SR;
      const env =
        kind === 'piano' ? Math.exp(-3 * t) * Math.min(1, i / atk) :
        kind === 'bass' ? Math.exp(-1.5 * t) * Math.min(1, i / atk) :
        Math.min(1, i / atk) * Math.min(1, (n - i) / (0.15 * SR));
      const ph = 2 * Math.PI * hz * t;
      let v: number;
      if (kind === 'piano') v = Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph);
      else if (kind === 'synth') v = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph) + 0.25 * Math.sin(4 * ph);
      else if (kind === 'lead') v = Math.sin(ph) + 0.11 * Math.sin(3 * ph) * (1 + 0.3 * Math.sin(2 * Math.PI * 5 * t));
      else if (kind === 'bass') v = Math.sin(ph) + 0.3 * Math.sin(2 * ph);
      else v = Math.sin(ph + 0.3 * Math.sin(2 * Math.PI * 0.5 * t)) + 0.3 * Math.sin(2.003 * ph);
      return v * env * amp;
    }, n);
  };

  const pluck = (t0: number, hz: number, amp: number) => {
    // Karplus–Strong
    const period = Math.max(2, Math.round(SR / hz));
    const n = Math.floor(1.5 * SR);
    const line = new Float32Array(period).map(() => rand() * 2 - 1);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i % period;
      const next = (j + 1) % period;
      out[i] = line[j] * amp;
      line[j] = 0.996 * 0.5 * (line[j] + line[next]);
    }
    add(music, t0, out);
  };

  const kick = (t0: number, amp: number) =>
    add(music, t0, (i) => { const t = i / SR; return Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-30 * t)) * t) * Math.exp(-8 * t) * amp; }, Math.floor(0.4 * SR));
  const snare = (t0: number, amp: number) =>
    add(music, t0, (i) => { const t = i / SR; return ((rand() * 2 - 1) * 0.8 + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-18 * t) * amp; }, Math.floor(0.25 * SR));
  let hp = 0;
  const hat = (t0: number, amp: number) =>
    add(music, t0, (i) => { const x = rand() * 2 - 1; const y = x - hp; hp = x; return y * Math.exp(-(i / SR) * 60) * amp; }, Math.floor(0.08 * SR));

  const playBar = (t0: number, numeral: string, intensity: number) => {
    const notes = chordNotes(keyPc, numeral);
    const lvl = 0.35 + 0.65 * intensity;
    if (has('strings')) notes.forEach((p) => tone(t0, bar + 0.1, midiToHz(p + 60), 0.05 * lvl, 'pad'));
    if (has('synth')) notes.forEach((p) => tone(t0, bar, midiToHz(p + 48), 0.035 * lvl, 'synth'));
    if (has('piano')) {
      for (let h = 0; h < (intensity > 0.5 ? 4 : 2); h++)
        notes.forEach((p) => tone(t0 + h * (bar / (intensity > 0.5 ? 4 : 2)), bar / 2, midiToHz(p + 60), 0.06 * lvl, 'piano'));
    }
    if (has('guitar')) {
      for (const b of intensity > 0.5 ? [0, 1, 2, 3] : [0, 2])
        [...notes, notes[0] + 12].forEach((p, k) => pluck(t0 + b * beat + k * 0.018, midiToHz(p + 48), 0.12 * lvl));
    }
    if (has('bass')) {
      for (const b of intensity > 0.4 ? [0, 2] : [0]) tone(t0 + b * beat, beat * 1.8, midiToHz(notes[0] + 36), 0.18 * lvl, 'bass');
    }
    if (has('drums') && c.drums !== 'none') {
      const d = c.drums;
      const kicks = d === 'soft' ? [0] : d === 'pop' ? [0, 2] : [0, 1, 2, 3];
      kicks.forEach((b) => kick(t0 + b * beat, 0.5 * lvl));
      if (d !== 'soft') [1, 3].forEach((b) => snare(t0 + b * beat, 0.18 * lvl));
      const sub = d === 'driving' ? 4 : 2;
      for (let k = 0; k < 4 * sub; k++) hat(t0 + (k * beat) / sub, (d === 'soft' ? 0.04 : 0.07) * lvl);
    }
  };

  let t = 0;
  const first = c.sections[0];
  for (let b = 0; b < c.intro_bars; b++, t += bar) playBar(t, first.chords[b % first.chords.length], 0.3);

  const sung: RenderedSong['sung'] = [];
  const jobs: Promise<void>[] = [];
  const voice = VOICE_MAP[c.voice];
  for (const sec of c.sections) {
    let barIdx = 0;
    for (const line of sec.lines) {
      const lineStart = t;
      for (let b = 0; b < BARS_PER_LINE; b++, t += bar, barIdx++) playBar(t, sec.chords[barIdx % sec.chords.length], sec.intensity);
      // melody guide (lead) over the first 1.5 bars of the line
      const span = bar * 1.5;
      line.melody.forEach((deg, k) => {
        const dur = span / line.melody.length;
        tone(lineStart + 0.1 + k * dur, dur * 0.95, midiToHz(scaleDegreeToMidi(keyPc, c.mode, deg)), 0.05, 'lead');
      });
      // vocal: fit the line into ~1.7 bars
      const words = line.text.split(/\s+/).filter(Boolean).length;
      const wpm = (words / (bar * 1.7)) * 60;
      sung.push({ text: line.text, section: sec.name });
      jobs.push(renderVocalLine(line.text, voice, Math.min(wpm, 200)).then((pcm) => add(vocals, lineStart + 0.1, pcm)));
    }
  }
  const last = c.sections[c.sections.length - 1];
  for (let b = 0; b < c.outro_bars; b++, t += bar) playBar(t, last.chords[b % last.chords.length], 0.25 * (1 - b / Math.max(1, c.outro_bars)));
  await Promise.all(jobs);

  // mix + normalise
  const mix = new Float32Array(total);
  let peak = 1e-6;
  for (let i = 0; i < total; i++) {
    mix[i] = 0.7 * music[i] + 1.0 * vocals[i];
    peak = Math.max(peak, Math.abs(mix[i]));
  }
  const g = 0.9 / peak;
  for (let i = 0; i < total; i++) mix[i] *= g;
  return { mix, vocals, sung, bpm: c.bpm };
}
