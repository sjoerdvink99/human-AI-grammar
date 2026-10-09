import { z } from "zod";

export const SCORE_INSTRUMENTS = ["piano", "acoustic guitar", "synth pad", "strings", "bass", "drums", "bells"] as const;

export const NoteSchema = z.object({
  word: z.string().describe("the word sung on this note"),
  degree: z.number().int().min(-7).max(15).describe("scale degree relative to the key: 1 = tonic, 8 = octave above, 0/-1 below"),
  beats: z.number().min(0.25).max(4),
});

export const ScoreSchema = z.object({
  bpm: z.number().min(55).max(170),
  key: z.enum(["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]),
  mode: z.enum(["major", "minor"]),
  instruments: z.array(z.enum(SCORE_INSTRUMENTS)).min(1),
  drumPattern: z.enum(["none", "soft", "pop", "driving", "halftime"]),
  swing: z.boolean(),
  vocalRegister: z.enum(["high", "low"]),
  vocalTone: z.enum(["soft", "warm", "bright", "airy"]),
  /** sections in play order; each references lyrics by its section label */
  arrangement: z
    .array(
      z.object({
        label: z.string().describe("e.g. Intro, Verse 1, Chorus, Verse 2, Bridge, Outro"),
        energy: z.number().min(0).max(1),
        chords: z.array(z.string()).min(1).describe("roman numerals per bar, e.g. I, vi, IV, V; cycled"),
        lines: z
          .array(z.object({ notes: z.array(NoteSchema) }))
          .describe("one entry per sung lyric line; empty for instrumental Intro/Outro"),
      }),
    )
    .min(3),
});
export type Score = z.infer<typeof ScoreSchema>;

const KEY_PC: Record<string, number> = { C: 0, "C#": 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export function keyPitchClass(key: string) {
  return KEY_PC[key] ?? 0;
}

/** scale degree (1-based, may exceed 7 or go below 1) -> MIDI note number */
export function degreeToMidi(degree: number, key: string, mode: "major" | "minor", baseOctaveMidi: number): number {
  const scale = mode === "major" ? MAJOR : MINOR;
  const d = degree - 1;
  const octave = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return baseOctaveMidi + keyPitchClass(key) + octave * 12 + scale[idx];
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

/** Parses a roman numeral chord like "vi", "IV", "bVII", "V7" into MIDI notes of a triad (root position). */
export function chordToMidi(chord: string, key: string, mode: "major" | "minor", base = 48): number[] {
  const m = chord.trim().match(/^(b|#)?(vii|vi|v|iv|iii|ii|i)(°|dim|maj7|7|sus2|sus4)?/i);
  if (!m) return chordToMidi("I", key, mode, base);
  const accidental = m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0;
  const degree = ROMAN[m[2].toLowerCase()];
  const upper = m[2] === m[2].toUpperCase();
  const root = degreeToMidi(degree, key, mode, base) + accidental;
  const suffix = (m[3] ?? "").toLowerCase();
  let third = upper ? 4 : 3;
  let fifth = 7;
  if (suffix === "°" || suffix === "dim") {
    third = 3;
    fifth = 6;
  }
  if (suffix === "sus2") third = 2;
  if (suffix === "sus4") third = 5;
  const notes = [root, root + third, root + fifth];
  if (suffix === "7") notes.push(root + 10);
  if (suffix === "maj7") notes.push(root + 11);
  return notes;
}

export function midiToHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
