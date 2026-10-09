/**
 * model_1 operations. One prompt per operation, built only from the representations
 * in the state that precedes the operation in design.json.
 */
import { z } from 'zod';
import { callModel } from './llm.ts';
import type { TherapyFramework } from './framework.ts';
import { allVariableNames } from './framework.ts';
import {
  type ChatMessage, type RequiredVariables, type StepStatus, type SongConcept, type LyricElements,
  type MusicAttributes, SongConceptSchema, LyricElementsSchema, GENRES, INSTRUMENTS, VOICES,
} from './types.ts';

const COMPANION = `You are a warm, careful songwriting companion trained in music-therapy-informed songwriting.
You help a person (the "client") turn their experience into a song. You are not a clinician: you never diagnose
or give medical advice. If the client mentions wanting to harm themselves or others, gently encourage them to
contact a local crisis line or someone they trust, in addition to continuing kindly.
Never assume the client's gender: refer to the client by name, as "you", or as "the client", never with he/she.`;

const fmtChat = (chat: ChatMessage[]) =>
  chat.length === 0 ? '(no messages yet)' : chat.map((m) => `${m.role === 'client' ? 'Client' : 'Companion'}: ${m.text}`).join('\n');

const fmtVars = (vars: RequiredVariables) =>
  Object.entries(vars).map(([k, v]) => `- ${k}: ${v ?? '(unknown)'}`).join('\n');

// ---------------- Process 1 ----------------

/** P1 [model_1 extract]: therapy_framework + chat_history → required_variables */
export async function extractRequiredVariables(framework: TherapyFramework, chat: ChatMessage[]): Promise<RequiredVariables> {
  const shape = Object.fromEntries(allVariableNames.map((n) => [n, z.string().nullable()]));
  const schema = z.object(shape);
  const varList = framework.steps
    .flatMap((s) => s.required_variables.map((v) => `- ${v.name} (${s.title}): ${v.description}`))
    .join('\n');
  const out = await callModel({
    role: 'model_1', op: 'extract required_variables', schema,
    system: `${COMPANION}\nYour task now: extract structured information from a conversation. Only fill a variable when the client has actually expressed it; otherwise use null. Use the client's own words where possible, in one short sentence. Never assume the client's gender: write values in the first person as the client would ("My grandmother passed away") or without pronouns.`,
    prompt: `Framework: ${framework.name}\nVariables to extract:\n${varList}\n\nConversation:\n${fmtChat(chat)}\n\nReturn every variable, null when not yet expressed by the client.`,
  });
  return out as RequiredVariables;
}

/** P1 [model_1 generate]~: framework + chat + required_variables + step_status → question */
export async function generateQuestion(
  framework: TherapyFramework, chat: ChatMessage[], vars: RequiredVariables, status: StepStatus,
): Promise<string> {
  const step = framework.steps[status.current_step];
  const situation =
    status.status === 'all_complete'
      ? 'All framework steps are complete. Briefly reflect what you heard, thank the client, and ask whether they are ready to start writing the song together.'
      : `Current step: "${step.title}" — goal: ${step.goal}\nStill missing: ${status.missing.join(', ')}.` +
        (status.status === 'step_complete' ? '\nThe previous step was just completed: acknowledge that gently and transition to this step.' : '');
  const out = await callModel({
    role: 'model_1', op: 'generate question', schema: z.object({ question: z.string().min(1) }),
    system: `${COMPANION}\nPrinciples:\n${framework.principles.map((p) => `- ${p}`).join('\n')}`,
    prompt: `Conversation so far:\n${fmtChat(chat)}\n\nWhat we know:\n${fmtVars(vars)}\n\n${situation}\n\nWrite the companion's next message: reflect briefly, then ask ONE open question aimed at what is missing.`,
  });
  return out.question.trim();
}

// ---------------- Process 2 ----------------

/** P2 [model_1 generate]~: chat_history + required_variables → lyric_questions */
export async function generateLyricQuestions(chat: ChatMessage[], vars: RequiredVariables): Promise<string[]> {
  const out = await callModel({
    role: 'model_1', op: 'generate lyric_questions',
    schema: z.object({ questions: z.array(z.string().min(1)).min(3).max(5) }),
    system: `${COMPANION}\nYour task now: ask songwriting prompts that draw out concrete, sensory, personal material for lyrics.`,
    prompt: `Conversation:\n${fmtChat(chat)}\n\nWhat we know:\n${fmtVars(vars)}\n\nWrite 4 short, specific songwriting questions for this client (e.g. an image, a place, a sentence they wish they could say, a line for the chorus). Address the client directly.`,
  });
  return out.questions;
}

/** P2 [model_1 extract]: lyric_inputs → song_concept + lyric_elements */
export async function extractSongConcept(lyricInputs: string): Promise<{ song_concept: SongConcept; lyric_elements: LyricElements }> {
  return callModel({
    role: 'model_1', op: 'extract song_concept + lyric_elements',
    schema: z.object({ song_concept: SongConceptSchema, lyric_elements: LyricElementsSchema }),
    system: `${COMPANION}\nYour task now: distil a client's songwriting answers into a song concept and the raw lyric material. Stay faithful to the client's words; invent nothing they did not express.`,
    prompt: `Client's songwriting answers:\n${lyricInputs}`,
  });
}

/** P2 [model_1 generate]~: song_concept + lyric_elements → lyrics */
export async function generateLyrics(concept: SongConcept, elements: LyricElements): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'generate lyrics', schema: z.object({ lyrics: z.string().min(20) }),
    system: `${COMPANION}\nYour task now: write song lyrics. Format with section headers on their own line in square brackets: [Verse 1], [Chorus], [Verse 2], [Bridge], [Outro]. 4 lines per section, short singable lines (max ~9 words), simple language, no rhyme for rhyme's sake. Total 4–6 sections.`,
    prompt: `Song concept:\n${JSON.stringify(concept, null, 2)}\n\nLyric elements (keep client_words verbatim somewhere in the song):\n${JSON.stringify(elements, null, 2)}`,
  });
  return out.lyrics.trim();
}

/** P2 [model_1 modify]~: lyrics + lyrics_feedback → lyrics (revised) */
export async function reviseLyrics(lyrics: string, feedback: string): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'modify lyrics', schema: z.object({ lyrics: z.string().min(20) }),
    system: `${COMPANION}\nYour task now: revise song lyrics according to the client's feedback. Change only what the feedback asks for; keep the [Section] header format and everything the client did not mention.`,
    prompt: `Current lyrics:\n${lyrics}\n\nClient feedback:\n${feedback}`,
  });
  return out.lyrics.trim();
}

// ---------------- Process 3 / 5 ----------------

/** P3 [model_1 generate]~: lyrics + song_concept → music_guidance */
export async function generateMusicGuidance(lyrics: string, concept: SongConcept): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'generate music_guidance', schema: z.object({ guidance: z.string().min(1) }),
    system: `${COMPANION}\nYour task now: help the client choose the musical setting of their song. Explain in plain words, without jargon, how genre, tempo, major/minor, instruments, voice and energy could support what the song is about. Offer 2–3 concrete options and invite them to choose. Max 150 words. Plain text only, no markdown.
Only suggest what the client can actually pick: genres ${GENRES.join(', ')}; instruments ${INSTRUMENTS.join(', ')}; voices ${VOICES.join(', ')}; tempo 50–160 bpm; major or minor; energy calm, moderate or driving; all songs are in 4/4.`,
    prompt: `Song concept:\n${JSON.stringify(concept, null, 2)}\n\nLyrics:\n${lyrics}`,
  });
  return out.guidance.trim();
}

/** P3/P5 [model_1 translate]~: lyrics + music_attributes → style_prompt */
export async function translateToStylePrompt(lyrics: string, attrs: MusicAttributes): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'translate music_attributes → style_prompt', schema: z.object({ style_prompt: z.string().min(1).max(400) }),
    system: `You write concise style prompts for a text-to-music model: a single comma-separated line of musical descriptors (genre, mood, tempo, key mode, instrumentation, vocal character, production, dynamics). No lyrics, no artist names. Max 300 characters.`,
    prompt: `Music attributes chosen by the client:\n${JSON.stringify(attrs, null, 2)}\n\nLyrics (for mood only):\n${lyrics}`,
  });
  return out.style_prompt.trim();
}

// ---------------- Process 4 ----------------

/** P4 [model_1 generate]~: song + music_visualization + lyrics → review_question */
export async function generateReviewQuestion(lyrics: string, songSummary: string): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'generate review_question', schema: z.object({ question: z.string().min(1) }),
    system: `${COMPANION}\nYour task now: the client has just listened to their song. Ask ONE warm, open question about how the song sounds and feels to them and whether it fits what they wanted to express. Max 2 sentences.`,
    prompt: `Song (description of the audio and its visualization):\n${songSummary}\n\nLyrics:\n${lyrics}`,
  });
  return out.question.trim();
}

/** P4 [model_1 generate]~: song + lyrics + song_feedback → reflection_question */
export async function generateReflectionQuestion(lyrics: string, songSummary: string, songFeedback: string): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'generate reflection_question', schema: z.object({ question: z.string().min(1) }),
    system: `${COMPANION}\nYour task now: invite deeper reflection. Briefly acknowledge the client's feedback, then ask ONE open question about what creating and hearing this song means for them, or what they notice in themselves now. Max 3 sentences.`,
    prompt: `Song:\n${songSummary}\n\nLyrics:\n${lyrics}\n\nClient's feedback on the song:\n${songFeedback}`,
  });
  return out.question.trim();
}

/** P4 [model_1 generate]~: reflection → supportive_response */
export async function generateSupportiveResponse(reflection: string): Promise<string> {
  const out = await callModel({
    role: 'model_1', op: 'generate supportive_response', schema: z.object({ response: z.string().min(1) }),
    system: `${COMPANION}\nYour task now: respond supportively to the client's reflection. Validate their feelings, name a strength you hear, and close the session warmly. Suggest one gentle way to keep using the song (e.g. listening when they need it). Max 120 words. No questions requiring an answer.`,
    prompt: `Client's reflection:\n${reflection}`,
  });
  return out.response.trim();
}
