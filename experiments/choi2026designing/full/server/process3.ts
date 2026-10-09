// Process 3 — Music generation and visualization, and
// Process 5 — Music revision (same pipeline starting from modified music_attributes).
//
// lyrics_1 + song_concept_1 -> [model_1 generate]~ -> music_guidance_1 -> [human specify]
// -> lyrics_1 + music_attributes_n -> [model_1 translate]~ -> style_prompt_n
// -> [model_2 generate]~ -> song_n -> [tool_2 extract] -> predicted_transcript_n + audio_features_n
// -> [tool_3 match] -> timed_lyrics_n -> [tool_4 extract] -> beat_features_n
// -> [tool_5 translate] -> music_visualization_n
import { z } from "zod";
import { callModel } from "./llm.ts";
import { SYSTEM_MODEL_1 } from "./persona.ts";
import { pushFeed, save } from "./store.ts";
import type { MusicAttributes, Session, Song, SongConcept } from "./types.ts";
import { generateSong } from "./music/generateSong.ts";
import { analyzeMusic } from "./tools/analysis.ts";
import { alignLyrics } from "./tools/align.ts";
import { extractBeats } from "./tools/beats.ts";
import { renderVisualization } from "./tools/visualize.ts";
import { startSongReview } from "./process4.ts";

/** model_1 generate~: lyrics + song_concept -> music_guidance */
export async function generateMusicGuidance(lyrics: string, concept: SongConcept): Promise<string> {
  const out = await callModel({
    role: "model_1",
    op: "model_1 generate (music guidance)",
    system: SYSTEM_MODEL_1,
    prompt:
      `Song concept: ${JSON.stringify(concept)}\nLyrics:\n${lyrics}\n\n` +
      "The lyrics are finished. Now help the person choose musical attributes: genre, mood, tempo (beats per minute), instruments and the kind of voice. " +
      "Explain each choice in accessible, non-auditory terms too (e.g. tempo as how fast the beat pulses or how a heartbeat feels; low instruments are felt more as vibration; " +
      "bright instruments look like sharp, sparkly visuals). Suggest 1–2 concrete options that fit this song and say why. Keep it under 180 words, friendly, with short paragraphs or bullet points.",
    schema: z.object({ guidance: z.string().min(20) }),
  });
  return out.guidance.trim();
}

/** model_1 translate~: lyrics + music_attributes -> style_prompt */
export async function translateToStylePrompt(lyrics: string, attributes: MusicAttributes): Promise<string> {
  const out = await callModel({
    role: "model_1",
    op: "model_1 translate (style prompt)",
    system: SYSTEM_MODEL_1,
    prompt:
      `Musical attributes chosen by the person: ${JSON.stringify(attributes)}\nLyrics (for context on mood only):\n${lyrics}\n\n` +
      "Translate the attributes into a concise style prompt for a music generation model: a comma-separated description of genre, mood, tempo in BPM, " +
      "instruments, vocal style and production feel. Include every chosen attribute and honour the person's extra notes. Do not include lyrics. Max 300 characters.",
    schema: z.object({ style_prompt: z.string().min(10).max(400) }),
  });
  return out.style_prompt.trim().slice(0, 300);
}

// ---------- orchestration ----------

export async function startMusicGuidance(s: Session, setBusy: (op: string, label: string) => void) {
  s.phase = "music_attributes";
  setBusy("model_1 generate", "Preparing music suggestions…");
  s.musicGuidance = await generateMusicGuidance(s.lyrics[s.lyrics.length - 1].text, s.songConcept!);
  pushFeed(s, { kind: "music_guidance", role: "assistant", text: s.musicGuidance });
  save(s);
}

/** human specify (process 3) / human modify (process 5): a new music_attributes version. */
export function recordMusicAttributes(s: Session, attributes: MusicAttributes) {
  s.musicAttributes.push(attributes);
  pushFeed(s, {
    kind: "music_attributes",
    role: "user",
    text: `${attributes.genre}, ${attributes.mood}, ${attributes.tempo_bpm} BPM, ${attributes.instruments.join(" + ")}, ${attributes.vocal}${attributes.notes ? ` — ${attributes.notes}` : ""}`,
  });
  save(s);
}

/** Shared by process 3 (first song) and process 5 (revision): from the latest music_attributes. */
export async function runSongFromAttributes(s: Session, setBusy: (op: string, label: string) => void) {
  const lyrics = s.lyrics[s.lyrics.length - 1].text;
  const attributes = s.musicAttributes[s.musicAttributes.length - 1];
  const version = s.songs.length + 1;
  setBusy("model_1 translate", "Turning your choices into a style prompt…");
  const stylePrompt = await translateToStylePrompt(lyrics, attributes);
  s.stylePrompts.push(stylePrompt);
  save(s);
  await runSongFromStylePrompt(s, setBusy);
}

/** model_2 generate~ and the analysis/visualization tool chain, from the latest style_prompt. */
export async function runSongFromStylePrompt(s: Session, setBusy: (op: string, label: string) => void) {
  const lyrics = s.lyrics[s.lyrics.length - 1].text;
  const attributes = s.musicAttributes[s.musicAttributes.length - 1];
  const stylePrompt = s.stylePrompts[s.stylePrompts.length - 1];
  const version = s.songs.length + 1;
  setBusy("model_2 generate", "Composing and producing your song (this can take a minute)…");
  const gen = await generateSong(lyrics, stylePrompt, `${s.id}-song${version}-${Date.now().toString(36)}`);

  setBusy("tool_2 extract", "Analysing the music…");
  const { predictedTranscript, audioFeatures } = analyzeMusic(gen.file, gen.vocalStemFile, gen.sungText);

  setBusy("tool_3 match", "Lining up the lyrics with the singing…");
  const timedLyrics = alignLyrics(lyrics, predictedTranscript);

  setBusy("tool_4 extract", "Finding the beats…");
  const beatFeatures = extractBeats(gen.file);

  setBusy("tool_5 translate", "Building the visualization…");
  const musicVisualization = renderVisualization(gen.duration, timedLyrics, audioFeatures, beatFeatures);

  const song: Song = {
    version,
    audioUrl: `/audio/${gen.file}`,
    duration: gen.duration,
    stylePrompt,
    attributes,
    createdAt: new Date().toISOString(),
    predictedTranscript,
    audioFeatures,
    timedLyrics,
    beatFeatures,
    musicVisualization,
  };
  s.songs.push(song);
  pushFeed(s, { kind: "song", role: "assistant", text: `Your song (version ${version}) is ready. Press play to see the lyrics and beats move with the music.`, ref: version });
  save(s);
  // process 4 continues from song + music_visualization + lyrics
  await startSongReview(s, setBusy);
}
