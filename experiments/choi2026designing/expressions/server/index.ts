import express from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { therapyFramework, allVariableNames } from './framework.ts';
import { evaluateStep } from './tools/evaluateStep.ts';
import * as M from './steps.ts';
import { runSongPipeline, describeSong } from './songPipeline.ts';
import { MusicAttributesSchema, type Session } from './types.ts';

const DATA = resolve('data');
const AUDIO = join(DATA, 'audio');
mkdirSync(AUDIO, { recursive: true });
const SESSION_FILE = join(DATA, 'session.json');

function freshSession(): Session {
  const required_variables = Object.fromEntries(allVariableNames.map((n) => [n, null]));
  return {
    stage: 'talk',
    chat_history: [],
    required_variables,
    step_status: evaluateStep(therapyFramework, required_variables),
    question: null,
    lyric_questions: null, lyric_inputs: null, song_concept: null, lyric_elements: null,
    lyrics: [], lyrics_approved: false,
    music_guidance: null, songs: [],
    review_question: null, song_feedback: null, reflection_question: null, reflection: null, supportive_response: null,
  };
}

let session: Session = existsSync(SESSION_FILE) ? JSON.parse(readFileSync(SESSION_FILE, 'utf8')) : freshSession();
let busy: string | null = null;
const save = () => writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

const app = express();
app.use(express.json({ limit: '1mb' }));

/** Wraps a step: one at a time, persists, returns the session; reports progress text via `busy`. */
const step = (fn: (body: any, progress: (m: string) => void) => Promise<void>) =>
  async (req: express.Request, res: express.Response) => {
    if (busy) return res.status(409).json({ error: `Busy: ${busy}` });
    busy = 'working…';
    try {
      await fn(req.body ?? {}, (m) => (busy = m));
      save();
      res.json(view());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: (e as Error).message });
    } finally {
      busy = null;
    }
  };

const view = () => ({ session, framework: therapyFramework, busy });
const latestLyrics = () => session.lyrics.at(-1)?.text ?? '';
const latestSong = () => session.songs.at(-1);
const requireText = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  return v.trim();
};

app.get('/api/session', (_req, res) => res.json(view()));
app.get('/api/status', (_req, res) => res.json({ busy }));
app.post('/api/reset', (_req, res) => {
  if (busy) return res.status(409).json({ error: 'Busy' });
  session = freshSession();
  save();
  res.json(view());
});
app.use('/api/audio', express.static(AUDIO));

// ---------- Process 1: framework-guided conversation (loop until tool_1 says all_complete) ----------
async function p1Round() {
  const s = session;
  // [model_1 extract] (skipped while the client has said nothing — nothing to extract)
  if (s.chat_history.some((m) => m.role === 'client'))
    s.required_variables = { ...s.required_variables, ...(await M.extractRequiredVariables(therapyFramework, s.chat_history)) };
  // [tool_1 evaluate]
  s.step_status = evaluateStep(therapyFramework, s.required_variables, s.step_status);
  // [model_1 generate]~
  s.question = await M.generateQuestion(therapyFramework, s.chat_history, s.required_variables, s.step_status);
  s.chat_history.push({ role: 'companion', text: s.question, at: Date.now() });
}
app.post('/api/p1/start', step(async () => {
  if (session.chat_history.length === 0) await p1Round();
}));
app.post('/api/p1/answer', step(async (b) => {
  // [human specify] → back to (therapy_framework + chat_history)
  session.chat_history.push({ role: 'client', text: requireText(b.text, 'answer'), at: Date.now() });
  session.question = null;
  await p1Round();
}));

// ---------- Process 2: lyrics ----------
app.post('/api/p2/questions', step(async () => {
  session.stage = 'lyrics';
  if (!session.lyric_questions)
    session.lyric_questions = await M.generateLyricQuestions(session.chat_history, session.required_variables);
}));
app.post('/api/p2/answers', step(async (b, progress) => {
  const qs = session.lyric_questions ?? [];
  const answers: unknown[] = Array.isArray(b.answers) ? b.answers : [];
  if (!answers.some((a) => typeof a === 'string' && a.trim())) throw new Error('Answer at least one question');
  // [human specify] → lyric_inputs
  session.lyric_inputs = qs.map((q, i) => `Q: ${q}\nA: ${String(answers[i] ?? '').trim() || '(skipped)'}`).join('\n\n');
  progress('Finding the heart of your song…');
  const { song_concept, lyric_elements } = await M.extractSongConcept(session.lyric_inputs); // [model_1 extract]
  session.song_concept = song_concept;
  session.lyric_elements = lyric_elements;
  progress('Writing lyrics…');
  const text = await M.generateLyrics(song_concept, lyric_elements); // [model_1 generate]~
  session.lyrics = [{ text, at: Date.now() }];
  session.lyrics_approved = false;
}));
app.post('/api/p2/feedback', step(async (b) => {
  // [human evaluate] → lyrics_feedback; [model_1 modify]~ → lyrics (loop)
  const feedback = requireText(b.feedback, 'feedback');
  const current = session.lyrics.at(-1);
  if (!current) throw new Error('No lyrics yet');
  current.feedback = feedback;
  const text = await M.reviseLyrics(current.text, feedback);
  session.lyrics.push({ text, at: Date.now() });
}));
app.post('/api/p2/approve', step(async () => {
  if (!session.lyrics.length) throw new Error('No lyrics yet');
  session.lyrics_approved = true;
  session.stage = 'music';
}));

// ---------- Process 3: music ----------
app.post('/api/p3/guidance', step(async () => {
  if (!session.song_concept) throw new Error('No song concept');
  session.stage = 'music';
  if (!session.music_guidance) session.music_guidance = await M.generateMusicGuidance(latestLyrics(), session.song_concept);
}));
/** Used by process 3 (first song, human specify) and process 5 (human modify → music_attributes_n). */
app.post('/api/p3/song', step(async (b, progress) => {
  const attrs = MusicAttributesSchema.parse(b.attributes);
  const version = session.songs.length + 1;
  const song = await runSongPipeline(latestLyrics(), attrs, version, AUDIO, progress);
  session.songs.push(song);
  // a new song starts a fresh review in process 4
  session.review_question = null;
  session.reflection_question = null;
  session.song_feedback = null;
}));

// ---------- Process 4: review & reflection ----------
app.post('/api/p4/review-question', step(async () => {
  const s = latestSong();
  if (!s) throw new Error('No song yet');
  session.stage = 'reflect';
  session.review_question = await M.generateReviewQuestion(latestLyrics(), describeSong(s));
}));
app.post('/api/p4/feedback', step(async (b) => {
  const s = latestSong();
  if (!s) throw new Error('No song yet');
  session.song_feedback = requireText(b.text, 'feedback'); // [human evaluate]
  s.song_feedback = session.song_feedback;
  session.reflection_question = await M.generateReflectionQuestion(latestLyrics(), describeSong(s), session.song_feedback);
}));
app.post('/api/p4/reflection', step(async (b) => {
  session.reflection = requireText(b.text, 'reflection'); // [human specify]
  session.supportive_response = await M.generateSupportiveResponse(session.reflection);
}));

if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => console.log(`API on http://localhost:${port}`));
server.requestTimeout = 0;
server.headersTimeout = 0;
