/**
 * model_2 generate~: lyrics + style_prompt → song (audio).
 *
 * No text-to-music service is available, so model_2 is realised as a separate model role
 * (a "composer" configuration of the same provider) that writes a symbolic score, which is
 * then rendered to audio. Replace this function with a call to a text-to-music API that
 * returns a mix and a vocal stem to swap the provider.
 */
import { join } from 'node:path';
import { callModel } from '../llm.ts';
import { CompositionSchema, type Composition } from './composition.ts';
import { renderComposition } from './synth.ts';
import { writeWav, SR } from './wav.ts';

export interface GeneratedSong {
  mixPath: string;
  vocalsPath: string;
  sampleRate: number;
  composition: Composition;
  /** What the vocal engine was asked to sing, in order. */
  sung: { text: string; section: string }[];
}

export async function generateSong(lyrics: string, stylePrompt: string, outDir: string, name: string): Promise<GeneratedSong> {
  const composition = await callModel({
    role: 'model_2', op: 'generate song (compose)', schema: CompositionSchema,
    system: `You are a songwriter-composer model. Given lyrics and a style prompt, you write a complete, singable song arrangement as a symbolic score.
Rules:
- Follow the style prompt for tempo (bpm), key mode, instruments, drums, vocal voice and energy.
- Use the lyrics' sections in order. Use each section's lines as the sung lines; you may repeat the chorus at the end.
- Section names must match the lyric headers without brackets.
- Chords are Roman numerals per bar in the chosen key; melodies are scale degrees (1 = tonic, 8 = octave), 4–8 notes per line, singable contours that rise toward the chorus.
- intensity: verses lower, choruses higher, bridge contrasting.
- intro_bars 1–4, outro_bars 1–4.`,
    prompt: `Style prompt:\n${stylePrompt}\n\nLyrics:\n${lyrics}`,
  });
  const rendered = await renderComposition(composition);
  const mixPath = join(outDir, `${name}.wav`);
  const vocalsPath = join(outDir, `${name}.vocals.wav`);
  writeWav(mixPath, rendered.mix);
  writeWav(vocalsPath, rendered.vocals);
  return { mixPath, vocalsPath, sampleRate: SR, composition, sung: rendered.sung };
}
