// Process 2 — Collaborative lyric writing
// chat_history_1 + required_variables_1 -> [model_1 generate]~ -> lyric_questions_1
// -> [human specify] -> lyric_inputs_1 -> [model_1 extract] -> song_concept_1 + lyric_elements_1
// -> [model_1 generate]~ -> lyrics_1 -> [human evaluate] -> lyrics_1 + lyrics_feedback_1
// -> [model_1 modify]~ -> lyrics_1 (loop until the person accepts)
import { z } from "zod";
import { callModel } from "./llm.ts";
import { SYSTEM_MODEL_1 } from "./persona.ts";
import { formatChat } from "./process1.ts";
import {
  LyricElementsSchema,
  SongConceptSchema,
  type ChatTurn,
  type LyricElements,
  type RequiredVariables,
  type Session,
  type SongConcept,
} from "./types.ts";
import { pushFeed, save } from "./store.ts";

/** Enforces "verses, a chorus and a bridge" where lyrics are produced. */
export function validateLyrics(text: string): string | null {
  const headers = [...text.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)].map((m) => m[1].toLowerCase());
  const verses = headers.filter((h) => h.startsWith("verse")).length;
  if (verses < 2) return "lyrics need at least two [Verse] sections";
  if (!headers.some((h) => h.startsWith("chorus"))) return "lyrics need a [Chorus] section";
  if (!headers.some((h) => h.startsWith("bridge"))) return "lyrics need a [Bridge] section";
  const lines = text.split("\n").filter((l) => l.trim() && !/^\s*\[/.test(l));
  if (lines.length < 10 || lines.length > 40) return "lyrics should have between 10 and 40 lines";
  return null;
}

const LyricsOut = z.object({
  lyrics: z
    .string()
    .describe("Full lyrics. Section headers on their own line in square brackets: [Verse 1], [Chorus], [Verse 2], [Bridge]. Chorus written once."),
});

async function lyricsCall(op: string, prompt: string): Promise<string> {
  let p = prompt;
  for (let i = 0; i < 2; i++) {
    const out = await callModel({ role: "model_1", op, system: SYSTEM_MODEL_1, prompt: p, schema: LyricsOut });
    const text = out.lyrics.replace(/\r/g, "").trim();
    const problem = validateLyrics(text);
    if (!problem) return text;
    p = `${prompt}\n\nYour previous attempt was rejected because the ${problem}. Fix that.`;
  }
  throw new Error("The lyrics did not have the required verse/chorus/bridge structure. Please retry.");
}

const LYRICS_FORMAT =
  "Format: section headers on their own lines exactly like [Verse 1], [Chorus], [Verse 2], [Bridge] (in that order; write the chorus once). " +
  "4 lines per verse and chorus, 2–4 lines in the bridge, short singable lines (4–9 words). No other commentary.";

/** model_1 generate~: chat_history + required_variables -> lyric_questions */
export async function generateLyricQuestions(chat: ChatTurn[], vars: RequiredVariables): Promise<string[]> {
  const out = await callModel({
    role: "model_1",
    op: "model_1 generate (lyric questions)",
    system: SYSTEM_MODEL_1,
    prompt:
      `Conversation so far:\n${formatChat(chat)}\n\nWhat we learned: ${JSON.stringify(vars)}\n\n` +
      "Now we move from talking to writing a song. Write 4 short, personal questions that help the person describe the song they want: " +
      "1) the emotions the song should carry, 2) a concrete scene or image (something seen, felt, touched — not only heard), " +
      "3) keywords or signs that matter to them, 4) any line, phrase or idea they already want in the lyrics. Refer to what they shared.",
    schema: z.object({ questions: z.array(z.string().min(3)).min(3).max(5) }),
  });
  return out.questions;
}

/** model_1 extract: lyric_inputs -> song_concept + lyric_elements */
export async function extractConceptAndElements(
  lyricInputs: string,
): Promise<{ songConcept: SongConcept; lyricElements: LyricElements }> {
  return callModel({
    role: "model_1",
    op: "model_1 extract (concept + elements)",
    system: SYSTEM_MODEL_1,
    prompt:
      `The person answered questions about the song they want to write:\n${lyricInputs}\n\n` +
      "Extract (1) the overall song concept and (2) the lyric elements: emotions, scenes, keywords and lyric ideas, kept close to their own words.",
    schema: z.object({ songConcept: SongConceptSchema, lyricElements: LyricElementsSchema }),
  });
}

/** model_1 generate~: song_concept + lyric_elements -> lyrics */
export function generateLyrics(concept: SongConcept, elements: LyricElements): Promise<string> {
  return lyricsCall(
    "model_1 generate (lyrics)",
    `Song concept: ${JSON.stringify(concept)}\nLyric elements: ${JSON.stringify(elements)}\n\n` +
      `Write complete song lyrics with verses, a chorus and a bridge, using the person's emotions, scenes, keywords and ideas. ` +
      `Prefer visual and physical imagery over sound imagery. ${LYRICS_FORMAT}`,
  );
}

/** model_1 modify~: lyrics + lyrics_feedback -> lyrics (new version) */
export function reviseLyrics(lyrics: string, feedback: string): Promise<string> {
  return lyricsCall(
    "model_1 modify (lyrics)",
    `Current lyrics:\n${lyrics}\n\nThe person's comments and requested changes:\n${feedback}\n\n` +
      `Revise the lyrics to address every comment while keeping what they did not ask to change. ${LYRICS_FORMAT}`,
  );
}

// ---------- orchestration ----------

export async function startLyricWriting(s: Session, setBusy: (op: string, label: string) => void) {
  s.phase = "lyric_questions";
  setBusy("model_1 generate", "Preparing questions about your song…");
  s.lyricQuestions = await generateLyricQuestions(s.chatHistory, s.requiredVariables);
  pushFeed(s, { kind: "lyric_questions", role: "assistant", text: s.lyricQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") });
  save(s);
}

export function formatLyricInputs(questions: string[], answers: string[]): string {
  return questions.map((q, i) => `Q: ${q}\nA: ${(answers[i] ?? "").trim() || "(no answer)"}`).join("\n\n");
}

/** human specify: lyric_inputs */
export function recordLyricInputs(s: Session, answers: string[]) {
  s.lyricInputs = formatLyricInputs(s.lyricQuestions, answers);
  pushFeed(s, { kind: "lyric_inputs", role: "user", text: answers.filter((a) => a.trim()).join("\n") });
  save(s);
}

export async function runLyricInputs(s: Session, setBusy: (op: string, label: string) => void) {
  setBusy("model_1 extract", "Shaping your song concept…");
  const { songConcept, lyricElements } = await extractConceptAndElements(s.lyricInputs ?? "");
  s.songConcept = songConcept;
  s.lyricElements = lyricElements;
  save(s);
  await runGenerateLyrics(s, setBusy);
}

export async function runGenerateLyrics(s: Session, setBusy: (op: string, label: string) => void) {
  setBusy("model_1 generate", "Writing your lyrics…");
  const text = await generateLyrics(s.songConcept!, s.lyricElements!);
  s.lyrics.push({ version: s.lyrics.length + 1, text });
  s.phase = "lyrics_review";
  pushFeed(s, { kind: "lyrics", role: "assistant", text: `Here are the lyrics (version ${s.lyrics.length}). Have a look on the right.`, ref: s.lyrics.length });
  save(s);
}

/** human evaluate: lyrics_feedback attached to the current lyrics version */
export function recordLyricsFeedback(s: Session, feedback: string) {
  s.lyrics[s.lyrics.length - 1].feedback = feedback;
  pushFeed(s, { kind: "lyrics_feedback", role: "user", text: feedback });
  save(s);
}

export async function runLyricsRevision(s: Session, setBusy: (op: string, label: string) => void) {
  const current = s.lyrics[s.lyrics.length - 1];
  setBusy("model_1 modify", "Revising the lyrics…");
  const text = await reviseLyrics(current.text, current.feedback ?? "");
  s.lyrics.push({ version: s.lyrics.length + 1, text });
  pushFeed(s, { kind: "lyrics", role: "assistant", text: `I revised the lyrics (version ${s.lyrics.length}).`, ref: s.lyrics.length });
  save(s);
}
