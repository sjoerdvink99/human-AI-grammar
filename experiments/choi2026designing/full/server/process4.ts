// Process 4 — Song discussion and reflection
// song + music_visualization + lyrics -> [model_1 generate]~ -> review_question
// -> [human evaluate] -> song_feedback -> [model_1 generate]~ -> reflection_question
// -> [human specify] -> reflection -> [model_1 generate]~ -> supportive_response
// If the person is not satisfied, process 5 (music revision) starts instead.
import { z } from "zod";
import { callModel } from "./llm.ts";
import { SYSTEM_MODEL_1 } from "./persona.ts";
import { pushFeed, save } from "./store.ts";
import type { Session, Song } from "./types.ts";

function describeSong(song: Song): string {
  const v = song.musicVisualization;
  return `Style prompt: ${song.stylePrompt}\nWhat the analysis found: ${v?.summary.join("; ") ?? "n/a"}`;
}

/** model_1 generate~: song + music_visualization + lyrics -> review_question */
export async function generateReviewQuestion(song: Song, lyrics: string, isRevision: boolean): Promise<string> {
  const out = await callModel({
    role: "model_1",
    op: "model_1 generate (review question)",
    system: SYSTEM_MODEL_1,
    prompt:
      `${describeSong(song)}\nLyrics:\n${lyrics}\n\nThe person has just ${isRevision ? "received a revised version of" : "received"} their song, with animated lyrics and beat visuals. ` +
      "Ask them, in 1–3 short sentences, how it feels to experience the song (through sound, vibration or the visuals) and whether they are satisfied with it or would like the music changed.",
    schema: z.object({ question: z.string().min(5) }),
  });
  return out.question.trim();
}

/** model_1 generate~: song + lyrics + song_feedback -> reflection_question */
export async function generateReflectionQuestion(song: Song, lyrics: string, feedback: string): Promise<string> {
  const out = await callModel({
    role: "model_1",
    op: "model_1 generate (reflection question)",
    system: SYSTEM_MODEL_1,
    prompt:
      `${describeSong(song)}\nLyrics:\n${lyrics}\n\nThe person accepted the song and said: "${feedback}"\n\n` +
      "Ask ONE gentle reflective question: which lyrics or musical moments resonated with them, and what feelings, memories or personal meaning they bring up. " +
      "You may quote a line from the lyrics as an example. Max 3 sentences.",
    schema: z.object({ question: z.string().min(5) }),
  });
  return out.question.trim();
}

/** model_1 generate~: reflection -> supportive_response */
export async function generateSupportiveResponse(reflection: string): Promise<string> {
  const out = await callModel({
    role: "model_1",
    op: "model_1 generate (supportive response)",
    system: SYSTEM_MODEL_1,
    prompt:
      `The person shared this reflection on the song they wrote:\n"${reflection}"\n\n` +
      "Write a warm, supportive reply (3–5 sentences): reflect back what they expressed, validate their feelings, acknowledge the courage and creativity of making this song, " +
      "and close the session kindly. Do not give clinical advice.",
    schema: z.object({ response: z.string().min(5) }),
  });
  return out.response.trim();
}

// ---------- orchestration ----------

export async function startSongReview(s: Session, setBusy: (op: string, label: string) => void) {
  s.phase = "song_review";
  setBusy("model_1 generate", "Thinking…");
  const song = s.songs[s.songs.length - 1];
  s.reviewQuestion = await generateReviewQuestion(song, s.lyrics[s.lyrics.length - 1].text, s.songs.length > 1);
  pushFeed(s, { kind: "review_question", role: "assistant", text: s.reviewQuestion });
  save(s);
}

/** human evaluate: song_feedback. Satisfied -> reflection; otherwise -> process 5. */
export function recordSongFeedback(s: Session, satisfied: boolean, text: string) {
  const song = s.songs[s.songs.length - 1];
  song.songFeedback = { satisfied, text };
  pushFeed(s, { kind: "song_feedback", role: "user", text: `${satisfied ? "I'm happy with it." : "I'd like to change the music."}${text ? ` ${text}` : ""}` });
  if (!satisfied) {
    s.phase = "revision";
    pushFeed(s, { kind: "system", role: "system", text: "Adjust your musical choices on the right and I'll make a new version with the same lyrics." });
  }
  save(s);
}

export async function runReflectionQuestion(s: Session, setBusy: (op: string, label: string) => void) {
  const song = s.songs[s.songs.length - 1];
  setBusy("model_1 generate", "Thinking…");
  s.reflectionQuestion = await generateReflectionQuestion(song, s.lyrics[s.lyrics.length - 1].text, song.songFeedback?.text || "I'm happy with it.");
  s.phase = "reflection";
  pushFeed(s, { kind: "reflection_question", role: "assistant", text: s.reflectionQuestion });
  save(s);
}

export function recordReflection(s: Session, reflection: string) {
  s.reflection = reflection;
  pushFeed(s, { kind: "reflection", role: "user", text: reflection });
  save(s);
}

export async function runSupportiveResponse(s: Session, setBusy: (op: string, label: string) => void) {
  setBusy("model_1 generate", "Thinking…");
  s.supportiveResponse = await generateSupportiveResponse(s.reflection ?? "");
  s.phase = "done";
  pushFeed(s, { kind: "supportive_response", role: "assistant", text: s.supportiveResponse });
  save(s);
}
