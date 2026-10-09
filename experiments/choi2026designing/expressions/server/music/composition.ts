import { z } from 'zod';
import { VOICES } from '../types.ts';

export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'i', 'iv', 'v', 'bIII', 'bVI', 'bVII'] as const;
export const DRUMS = ['none', 'soft', 'pop', 'driving'] as const;
export const SOUNDS = ['piano', 'guitar', 'strings', 'synth', 'bass', 'drums'] as const;

/** Symbolic score produced by model_2 and rendered to audio by the synthesizer. */
export const CompositionSchema = z.object({
  key: z.enum(KEYS),
  mode: z.enum(['major', 'minor']),
  bpm: z.number().int().min(50).max(160),
  voice: z.enum(VOICES),
  instruments: z.array(z.enum(SOUNDS)).min(1),
  drums: z.enum(DRUMS),
  intro_bars: z.number().int().min(0).max(8),
  outro_bars: z.number().int().min(0).max(8),
  sections: z
    .array(
      z.object({
        name: z.string().describe('Section name exactly as in the lyrics header, e.g. Verse 1, Chorus'),
        chords: z.array(z.enum(NUMERALS)).min(1).max(8).describe('One Roman-numeral chord per bar, cycled through the section'),
        intensity: z.number().min(0).max(1).describe('0 = sparse, 1 = full'),
        lines: z
          .array(
            z.object({
              text: z.string().min(1).describe('The sung line'),
              melody: z.array(z.number().int().min(1).max(10)).min(1).max(12).describe('Scale degrees, 1 = tonic, 8 = octave'),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type Composition = z.infer<typeof CompositionSchema>;
