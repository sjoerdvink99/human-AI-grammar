import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { project, save, resetProject, MEDIA_DIR, putMedia, readMedia } from "./store.ts";
import { ConceptSchema, type Scene } from "./types.ts";
import { availableVoices } from "./provider.ts";
import * as P from "./pipeline.ts";
import { composeClarifyPrompt, composeTitleImage, composeTitleText, extractMetadata } from "./tools.ts";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use("/media", express.static(MEDIA_DIR, { maxAge: "1y", immutable: true }));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const need = (cond: unknown, msg: string) => {
  if (!cond) throw new HttpError(400, msg);
};

/** Runs a background job; the client polls GET /api/project while project.busy is set. */
function startJob(step: string, fn: (progress: (m: string) => void) => Promise<void>) {
  if (project.busy) throw new HttpError(409, `Busy: ${project.busy.message}`);
  project.busy = { step, message: "Starting…", startedAt: new Date().toISOString() };
  project.error = null;
  const progress = (m: string) => {
    if (project.busy) project.busy.message = m;
    void save();
  };
  fn(progress)
    .catch((e) => {
      console.error(`[${step}]`, e);
      project.error = `${step}: ${e instanceof Error ? e.message : String(e)}`;
    })
    .finally(() => {
      project.busy = null;
      void save();
    });
}

type Handler = (req: express.Request) => Promise<unknown> | unknown;
const route = (h: Handler) => async (req: express.Request, res: express.Response) => {
  try {
    const out = await h(req);
    res.json(out ?? project);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
  }
};

function sceneById(id: unknown): Scene {
  const s = project.scenes.find((x) => x.id === id);
  if (!s) throw new HttpError(404, "Unknown scene");
  return s;
}
function replaceScene(next: Scene) {
  // [tool_1 modify] write the regenerated clip back into r19*
  project.scenes = project.scenes.map((s) => (s.id === next.id ? next : s));
}

// ---------------- read ----------------
app.get("/api/project", route(() => project));
app.get("/api/voices", route(async () => ({ voices: await availableVoices() })));
app.post(
  "/api/reset",
  route(async () => {
    need(!project.busy, "Busy");
    resetProject();
    await save();
  }),
);

// ---------------- r1 source ----------------
app.post(
  "/api/paper",
  route(async (req) => {
    const text = String(req.body?.text ?? "").trim();
    need(text.length >= 200, "The document needs at least 200 characters.");
    need(!project.busy, "Busy");
    resetProject();
    project.paper = text;
    await save();
  }),
);

app.post(
  "/api/paper/pdf",
  express.raw({ type: "application/pdf", limit: "40mb" }),
  route(async (req) => {
    const buf = req.body as Buffer;
    need(Buffer.isBuffer(buf) && buf.length > 0, "Empty upload");
    const text = await new Promise<string>((resolve, reject) => {
      const c = spawn("pdftotext", ["-layout", "-", "-"]);
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.on("error", () => reject(new HttpError(501, "pdftotext is not installed; paste the text instead.")));
      c.on("close", (code) => (code === 0 ? resolve(out) : reject(new HttpError(400, "Could not read PDF"))));
      c.stdin.end(buf);
    });
    return { text: text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim() };
  }),
);

// ---------------- process 1 ----------------
app.post(
  "/api/p1/run",
  route(() => {
    need(project.paper, "Add a document first.");
    startJob("Find concepts", async (progress) => {
      const paper = project.paper;
      Object.assign(project, { keyPoints: [], angles: [], pitches: [], pitchScores: [], shortlist: [], concepts: [] });
      progress("Extracting key points (1/6)…");
      project.keyPoints = await P.extractKeyPoints(paper);
      progress("Generating story angles (2/6)…");
      project.angles = await P.generateAngles(paper, project.keyPoints);
      progress("Writing pitches (3/6)…");
      project.pitches = await P.generatePitches(paper, project.angles);
      progress("Scoring pitches (4/6)…");
      project.pitchScores = await P.evaluatePitches(paper, project.pitches);
      progress("Selecting the shortlist (5/6)…");
      project.shortlist = await P.selectPitches(paper, project.pitches, project.pitchScores);
      progress("Drafting concepts (6/6)…");
      project.concepts = await P.generateConcepts(paper, project.shortlist);
    });
  }),
);

// ---------------- process 2 ----------------
function askQuestions() {
  startJob("Clarify", async (progress) => {
    const concept = project.concept!;
    project.clarifyPrompt = composeClarifyPrompt(concept); // [tool_1 compose] r8 -> r9
    project.questions = "";
    progress("Preparing questions…");
    project.questions = (await P.generateQuestions(concept, project.clarifyPrompt)).join("\n");
  });
}

app.post(
  "/api/p2/select",
  route((req) => {
    const i = Number(req.body?.index);
    need(Number.isInteger(i) && project.concepts[i], "Pick one of the concepts.");
    project.concept = structuredClone(project.concepts[i]); // [human select] r7* -> r8
    Object.assign(project, { clarifyPrompt: "", questions: "", preferences: "", script: "", scenes: [], titleCard: null });
    askQuestions();
  }),
);

app.post(
  "/api/p2/questions",
  route(() => {
    need(project.concept, "Choose a concept first.");
    askQuestions();
  }),
);

app.post(
  "/api/p2/script",
  route((req) => {
    need(project.concept && project.clarifyPrompt, "Choose a concept first.");
    const answers: string[] = Array.isArray(req.body?.answers) ? req.body.answers.map(String) : [];
    const notes = String(req.body?.notes ?? "").trim();
    const qs = project.questions.split("\n").filter(Boolean);
    // [human specify] -> r11
    project.preferences = [
      ...qs.map((q, i) => `Q: ${q}\nA: ${answers[i]?.trim() || "(no preference)"}`),
      notes ? `Additional notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    startJob("Write script", async (progress) => {
      progress("Writing the narration script…");
      project.script = await P.composeScript(project.concept!, project.clarifyPrompt, project.preferences);
    });
  }),
);

// ---------------- process 3 ----------------
app.put(
  "/api/concept",
  route(async (req) => {
    need(project.concept, "Choose a concept first.");
    need(!project.busy, "Busy");
    const parsed = ConceptSchema.safeParse(req.body?.concept);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    project.concept = parsed.data; // [human modify] r8 (same version, in place)
    await save();
  }),
);

// ---------------- process 4 ----------------
app.post(
  "/api/p4/plan",
  route(() => {
    need(project.concept && project.script, "Write the script first.");
    startJob("Plan scenes", async (progress) => {
      project.scenes = [];
      project.titleCard = null;
      progress("Splitting the script into scenes…");
      const texts = await P.decomposeScript(project.concept!, project.script); // r13*
      project.scenes = texts.map((text) => ({
        id: randomUUID(),
        text,
        visualPrompt: "",
        voice: project.voice,
        audio: null,
        duration: null,
        image: null,
        at: new Date().toISOString(),
        history: [],
      }));
      progress("Describing visuals for each scene…");
      const prompts = await P.generateVisualPrompts(texts, project.script); // r14*
      project.scenes = project.scenes.map((s, i) => ({ ...s, visualPrompt: prompts[i] }));
    });
  }),
);

app.post(
  "/api/p4/produce",
  route(async (req) => {
    need(project.scenes.length && project.scenes.every((s) => s.visualPrompt), "Plan the scenes first.");
    const voices = await availableVoices();
    const voice = String(req.body?.voice ?? "");
    need(voices.includes(voice), "Choose a voice from the list."); // r15 categorical
    project.voice = voice;
    startJob("Produce clips", async (progress) => {
      const n = project.scenes.length;
      const ids = project.scenes.map((s) => s.id);
      // model_3 generate r16* + tool_1 extract r17*
      const voiced: { audio: string; duration: number }[] = [];
      for (let i = 0; i < n; i++) {
        progress(`Narrating scene ${i + 1}/${n}…`);
        voiced.push(await P.voiceScene(project.scenes[i].text, voice));
      }
      // model_2 generate r18*, then tool_2 compose r19* (each clip as soon as its image is ready)
      let done = 0;
      progress(`Drawing scenes (0/${n})…`);
      await P.mapLimit(ids, 3, async (id, i) => {
        const s = sceneById(id);
        const image = await P.drawScene(s.visualPrompt);
        replaceScene(P.composeClip(sceneById(id), { text: s.text, visualPrompt: s.visualPrompt, voice, ...voiced[i], image }));
        progress(`Drawing scenes (${++done}/${n})…`);
      });
    });
  }),
);

// ---------------- process 5: re-voice one scene ----------------
app.post(
  "/api/p5/revoice",
  route(async (req) => {
    const scene = sceneById(req.body?.sceneId); // r20
    const voices = await availableVoices();
    const voice = String(req.body?.voice ?? "");
    need(voices.includes(voice), "Choose a voice from the list."); // r21
    startJob("Regenerate scene", async (progress) => {
      const idx = project.scenes.indexOf(scene) + 1;
      progress(`Narrating scene ${idx}…`);
      const voiced = await P.voiceScene(scene.text, voice); // r22 + r23
      progress(`Drawing scene ${idx}…`);
      const image = await P.drawScene(scene.visualPrompt); // r24
      replaceScene(P.composeClip(sceneById(scene.id), { text: scene.text, visualPrompt: scene.visualPrompt, voice, ...voiced, image })); // r25 -> r19
    });
  }),
);

// ---------------- process 6: edit one scene's narration ----------------
app.post(
  "/api/p6/edit",
  route((req) => {
    const scene = sceneById(req.body?.sceneId);
    const text = String(req.body?.text ?? "").trim();
    need(text.length >= 3, "Narration cannot be empty.");
    need(text !== scene.text, "The narration is unchanged.");
    startJob("Update scene", async (progress) => {
      const index = project.scenes.findIndex((s) => s.id === scene.id);
      const texts = project.scenes.map((s, i) => (i === index ? text : s.text)); // r13_2*
      progress(`Re-describing the visual for scene ${index + 1}…`);
      const prompts = await P.regenerateVisualPrompt(
        texts,
        project.scenes.map((s) => s.visualPrompt),
        index,
        project.script,
      ); // r14_2*
      progress(`Narrating scene ${index + 1}…`);
      const voiced = await P.voiceScene(text, scene.voice); // r26 + r27
      progress(`Drawing scene ${index + 1}…`);
      const image = await P.drawScene(prompts[index]); // r28
      replaceScene(P.composeClip(sceneById(scene.id), { text, visualPrompt: prompts[index], voice: scene.voice, ...voiced, image })); // r29 -> r19
    });
  }),
);

// ---------------- process 7 (server half) ----------------
app.post(
  "/api/p7/prepare",
  route(async () => {
    const ready = project.scenes.filter((s) => s.image && s.audio);
    need(ready.length, "Produce the clips first.");
    const frame = ready[0].image; // [tool_1 extract] r19* -> r30
    const metadata = extractMetadata(project.paper); // [tool_1 extract] r1 -> r31*
    const text = composeTitleText(metadata.length ? metadata : [project.concept?.title ?? "Untitled"]); // [tool_1 compose] r32
    project.titleCard = { frame, metadata, text, image: null };
    await save();
  }),
);

app.put(
  "/api/p7/title",
  route(async (req) => {
    need(project.titleCard, "Prepare the title card first.");
    const text = String(req.body?.text ?? "").trim(); // [human modify] r32_1 -> r32_2 (edited in the UI, sent here)
    need(text, "Title text cannot be empty.");
    const frame = project.titleCard!.frame;
    // [tool_1 compose] r30 + r32_2 -> r33
    const image = await putMedia(composeTitleImage(frame ? await readMedia(frame) : null, text), "svg");
    project.titleCard = { ...project.titleCard!, text, image };
    await save();
  }),
);

// ---------------- static client in production ----------------
const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT || 3001);
const server = app.listen(port, () => console.log(`server on http://localhost:${port}`));
server.requestTimeout = 0;
