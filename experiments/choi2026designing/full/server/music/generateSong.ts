// model_2 generate~ — music generation model.
// lyrics + style_prompt -> song (audio with vocals).
//
// No audio-generation model is available, so model_2 is a separately configured
// Claude call that composes a full symbolic score (melody per lyric word,
// chords, arrangement); the deterministic synthesizer then renders it to audio.
// Swap this function for a real text-to-song API without touching the rest.
import { join } from "node:path";
import { callModel } from "../llm.ts";
import { ScoreSchema, type Score } from "./score.ts";
import { renderScore } from "./synth.ts";
import { writeWav } from "./wav.ts";
import { AUDIO_DIR } from "../store.ts";

export interface GeneratedSong {
  file: string;
  /** separated vocal stem, as text-to-song services commonly return */
  vocalStemFile: string;
  duration: number;
  /** the lyric text the generator reports having sung (its own transcript sidecar) */
  sungText: string;
}

const SYSTEM_MODEL_2 =
  "You are a music generation model. Given lyrics and a style description you compose a complete song as a symbolic score. " +
  "You are a skilled songwriter: singable melodies within about an octave, clear contrast between verse and chorus, a lifted bridge, " +
  "chord progressions that suit the mood, and a tempo, key and instrumentation that match the style. Reply with the JSON score only.";

export async function composeScore(lyrics: string, stylePrompt: string): Promise<Score> {
  return callModel({
    role: "model_2",
    op: "model_2 generate (score)",
    system: SYSTEM_MODEL_2,
    prompt:
      `Style: ${stylePrompt}\n\nLyrics:\n${lyrics}\n\n` +
      "Compose the song. Arrangement in play order, typically: Intro (instrumental), Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus, Outro (instrumental). " +
      "Repeat the chorus lyrics where the chorus repeats. For each sung line give one note per word, in order, with the word written exactly as in the lyrics " +
      "(no punctuation). Each line should total 6–7.5 beats so it fits two 4/4 bars (use 0.5-beat notes for quick words, 1.5–2 beats on the last word). Use scale degrees for pitch (1 = tonic). Instrumental sections have an empty lines array. " +
      "Energy 0–1 per section (choruses higher). Choose instruments only from the allowed list.",
    schema: ScoreSchema,
  });
}

export async function generateSong(lyrics: string, stylePrompt: string, fileStem: string): Promise<GeneratedSong> {
  const score = await composeScore(lyrics, stylePrompt);
  const seed = [...fileStem].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rendered = renderScore(score, seed);
  const file = `${fileStem}.wav`;
  const vocalStemFile = `${fileStem}-vocals.wav`;
  writeWav(join(AUDIO_DIR, file), rendered.mix, rendered.sampleRate);
  writeWav(join(AUDIO_DIR, vocalStemFile), rendered.vocal, rendered.sampleRate);
  const sungText = score.arrangement
    .flatMap((sec) => sec.lines.map((l) => l.notes.map((nt) => nt.word).join(" ")))
    .join("\n");
  return { file, vocalStemFile, duration: rendered.duration, sungText };
}
