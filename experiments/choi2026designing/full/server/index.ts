import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AUDIO_DIR, createSession, getSession, runJob, save, pushFeed } from "./store.ts";
import { THERAPY_FRAMEWORK } from "./framework.ts";
import { addAnswer, runTherapyRound } from "./process1.ts";
import { recordLyricInputs, recordLyricsFeedback, runGenerateLyrics, runLyricInputs, runLyricsRevision, startLyricWriting } from "./process2.ts";
import { recordMusicAttributes, runSongFromAttributes, runSongFromStylePrompt, startMusicGuidance } from "./process3.ts";
import { recordReflection, recordSongFeedback, runReflectionQuestion, runSupportiveResponse, startSongReview } from "./process4.ts";
import { MusicAttributesSchema, type Session } from "./types.ts";

type Chain = (s: Session, setBusy: (op: string, label: string) => void) => Promise<void>;

/** Model/tool chains that run in the background after a human step. Names double as retry actions. */
const CHAINS: Record<string, Chain> = {
  therapy_round: runTherapyRound, // process 1
  lyric_questions: startLyricWriting, // process 2
  lyric_inputs: runLyricInputs,
  lyrics_generate: runGenerateLyrics,
  lyrics_revise: runLyricsRevision,
  music_guidance: startMusicGuidance, // process 3
  song_from_attributes: runSongFromAttributes, // process 3 & 5
  song_regenerate: runSongFromStylePrompt,
  song_review: startSongReview, // process 4
  reflection_question: runReflectionQuestion,
  supportive_response: runSupportiveResponse,
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/audio", express.static(AUDIO_DIR));

function load(req: Request, res: Response): Session | null {
  const s = getSession(String(req.params.id));
  if (!s) {
    res.status(404).json({ error: "session not found" });
    return null;
  }
  if (s.busy && req.method === "POST") {
    res.status(409).json({ error: "Still working on the previous step" });
    return null;
  }
  return s;
}

function start(res: Response, s: Session, chain: string) {
  runJob(s, chain, (setBusy) => CHAINS[chain](s, setBusy));
  res.json(s);
}

const text = z.object({ text: z.string().trim().min(1).max(4000) });

app.get("/api/framework", (_req, res) => res.json(THERAPY_FRAMEWORK));

app.post("/api/sessions", (_req, res) => {
  const s = createSession();
  start(res, s, "therapy_round");
});

app.get("/api/sessions/:id", (req, res) => {
  const s = getSession(String(req.params.id));
  if (!s) return res.status(404).json({ error: "session not found" });
  res.json(s);
});

// Process 1 — human specify
app.post("/api/sessions/:id/therapy/answer", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  if (s.phase !== "therapy") return res.status(400).json({ error: "not in the conversation phase" });
  const body = text.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Please write an answer first." });
  addAnswer(s, body.data.text);
  start(res, s, "therapy_round");
});

// Process 2 — human specify (lyric inputs)
app.post("/api/sessions/:id/lyrics/inputs", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  const body = z.object({ answers: z.array(z.string().max(2000)) }).safeParse(req.body);
  if (!body.success || !body.data.answers.some((a) => a.trim())) return res.status(400).json({ error: "Please answer at least one question." });
  recordLyricInputs(s, body.data.answers);
  start(res, s, "lyric_inputs");
});

// Process 2 — human evaluate (request changes -> model_1 modify)
app.post("/api/sessions/:id/lyrics/feedback", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  const body = text.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Please describe what to change." });
  recordLyricsFeedback(s, body.data.text);
  start(res, s, "lyrics_revise");
});

// Process 2 — regenerate lyrics from the same concept + elements
app.post("/api/sessions/:id/lyrics/regenerate", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  if (!s.songConcept || !s.lyricElements) return res.status(400).json({ error: "no song concept yet" });
  start(res, s, "lyrics_generate");
});

// Process 2 — human evaluate (accept) -> process 3 starts
app.post("/api/sessions/:id/lyrics/accept", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  if (!s.lyrics.length) return res.status(400).json({ error: "no lyrics yet" });
  s.lyricsAccepted = true;
  pushFeed(s, { kind: "system", role: "user", text: `I'm happy with the lyrics (version ${s.lyrics.length}).` });
  save(s);
  start(res, s, "music_guidance");
});

// Process 3 — human specify / Process 5 — human modify (music attributes)
app.post("/api/sessions/:id/music/attributes", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  if (s.phase !== "music_attributes" && s.phase !== "revision") return res.status(400).json({ error: "not choosing music now" });
  const body = MusicAttributesSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  recordMusicAttributes(s, body.data);
  start(res, s, "song_from_attributes");
});

// regenerate the song with the same style prompt (another sample from model_2)
app.post("/api/sessions/:id/music/regenerate", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  if (!s.stylePrompts.length) return res.status(400).json({ error: "no style prompt yet" });
  start(res, s, "song_regenerate");
});

// Process 4 — human evaluate (song feedback)
app.post("/api/sessions/:id/song/feedback", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  const body = z.object({ satisfied: z.boolean(), text: z.string().max(4000).default("") }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid feedback" });
  recordSongFeedback(s, body.data.satisfied, body.data.text.trim());
  if (body.data.satisfied) start(res, s, "reflection_question");
  else res.json(s);
});

// Process 4 — human specify (reflection)
app.post("/api/sessions/:id/reflection", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  const body = text.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Please write a reflection first." });
  recordReflection(s, body.data.text);
  start(res, s, "supportive_response");
});

app.post("/api/sessions/:id/retry", (req, res) => {
  const s = load(req, res);
  if (!s) return;
  if (!s.error || !CHAINS[s.error.retry]) return res.status(400).json({ error: "nothing to retry" });
  start(res, s, s.error.retry);
});

const dist = join(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|audio).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
