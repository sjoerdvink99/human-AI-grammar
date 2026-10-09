import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import * as store from "./store.ts";
import * as P from "./pipeline.ts";
import { pdfToText, pdfInfo, guessTitle, extractAuthors, paperScreenshot } from "./tools/paper.ts";
import { composeBaselineVoiceStyle } from "./tools/voice.ts";
import { composeCreditText, composeCreditScene } from "./tools/credits.ts";
import { stillToClip, concatClips } from "./tools/media.ts";
import { REGENERATION_REQUESTS, MERGE_REQUESTS, type Project, type RegenerationRequest, type MergeRequest } from "./types.ts";

const app = express();
app.use(express.json({ limit: "5mb" }));
const upload = multer({ dest: path.join(store.DATA_DIR, "..", "uploads"), limits: { fileSize: 50 * 1024 * 1024 } });

/** In-memory per-scene job status: "rendering" or an error message. */
const sceneStatus = new Map<string, Record<number, string>>();
function setStatus(id: string, i: number, s: string | null) {
  const m = sceneStatus.get(id) ?? {};
  if (s === null) delete m[i];
  else m[i] = s;
  sceneStatus.set(id, m);
}
const view = (p: Project) => ({ ...p, sceneStatus: sceneStatus.get(p.id) ?? {} });

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) throw Object.assign(new Error(`${what} is missing`), { status: 400 });
  return v;
}
const id = (req: Request) => req.params.id as string;

// ---------- projects ----------
app.get("/api/projects", h(async (_req, res) => res.json(await store.listProjects())));
app.post("/api/projects", h(async (_req, res) => res.json(view(await store.createProject()))));
app.get("/api/projects/:id", h(async (req, res) => res.json(view(await store.load(id(req))))));

// ---------- process 1: paper_1 → … → script_options_1 ----------
app.post(
  "/api/projects/:id/paper",
  upload.single("pdf"),
  h(async (req, res) => {
    const pid = id(req);
    let paper: Project["paper"];
    if (req.file) {
      const dest = store.mediaPath(pid, store.uniqueName("paper", "pdf"));
      await fs.rename(req.file.path, dest.file);
      const [text, info] = await Promise.all([pdfToText(dest.file), pdfInfo(dest.file)]);
      if (text.trim().length < 200) throw Object.assign(new Error("Could not extract text from this PDF (scanned?)"), { status: 400 });
      paper = { title: (req.body.title as string)?.trim() || guessTitle(text, info.Title), text, pdfFile: dest.url };
    } else {
      const text = String(req.body.text ?? "").trim();
      if (text.length < 200) throw Object.assign(new Error("Paste the paper text (at least 200 characters)"), { status: 400 });
      paper = { title: String(req.body.title ?? "").trim() || guessTitle(text), text };
    }
    // A new paper invalidates everything derived from the previous one.
    const p = await store.update(pid, (p) => {
      for (const k of Object.keys(p) as (keyof Project)[]) if (k !== "id" && k !== "createdAt") delete p[k];
      p.paper = paper;
    });
    res.json(view(p));
  }),
);

app.post("/api/projects/:id/findings", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const findings = await P.extractFindings(need(p0.paper, "paper"));
  res.json(view(await store.update(p0.id, (p) => void (p.findings = findings))));
}));

app.post("/api/projects/:id/story-ideas", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const storyIdeas = await P.generateStoryIdeas(need(p0.paper, "paper"), need(p0.findings, "findings"));
  res.json(view(await store.update(p0.id, (p) => void (p.storyIdeas = storyIdeas))));
}));

app.post("/api/projects/:id/hooks", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const hooks = await P.generateHooks(need(p0.paper, "paper"), need(p0.storyIdeas, "story ideas"));
  res.json(view(await store.update(p0.id, (p) => { p.hooks = hooks; delete p.hookRatings; })));
}));

app.post("/api/projects/:id/hook-ratings", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const hookRatings = await P.rateHooks(need(p0.paper, "paper"), need(p0.hooks, "hooks"));
  res.json(view(await store.update(p0.id, (p) => void (p.hookRatings = hookRatings))));
}));

app.post("/api/projects/:id/shortlist", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const shortlisted = await P.shortlistHooks(need(p0.paper, "paper"), need(p0.hooks, "hooks"), need(p0.hookRatings, "hook ratings"));
  res.json(view(await store.update(p0.id, (p) => void (p.shortlistedHooks = shortlisted))));
}));

app.post("/api/projects/:id/script-options", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const options = await P.generateScriptOptions(need(p0.paper, "paper"), need(p0.shortlistedHooks, "shortlisted hooks"));
  res.json(view(await store.update(p0.id, (p) => void (p.scriptOptions = options))));
}));

// ---------- process 2: script selection and voice style ----------
app.post("/api/projects/:id/script/select", h(async (req, res) => {
  const index = Number(req.body.index);
  const p = await store.update(id(req), (p) => {
    const opt = need(p.scriptOptions?.[index], "script option");
    p.script = { ...opt }; // [human select]
    p.baselineVoiceStyle = composeBaselineVoiceStyle(p.script); // [tool_1 compose]
    delete p.toneSuggestion;
    delete p.tonePreference;
    delete p.voiceStyle;
  });
  res.json(view(p));
}));

app.post("/api/projects/:id/tone-suggestion", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const s = await P.suggestTone(need(p0.script, "script"), need(p0.baselineVoiceStyle, "baseline voice style"));
  res.json(view(await store.update(p0.id, (p) => void (p.toneSuggestion = s))));
}));

app.post("/api/projects/:id/voice-style", h(async (req, res) => {
  const tonePreference = String(req.body.tonePreference ?? "").trim();
  need(tonePreference || null, "tone preference");
  const p0 = await store.load(id(req));
  const vs = await P.composeVoiceStyle(need(p0.script, "script"), need(p0.baselineVoiceStyle, "baseline voice style"), tonePreference);
  res.json(view(await store.update(p0.id, (p) => { p.tonePreference = tonePreference; p.voiceStyle = vs; })));
}));

// ---------- process 3: human modify script ----------
app.put("/api/projects/:id/script", h(async (req, res) => {
  const script = P.validateScript(req.body);
  res.json(view(await store.update(id(req), (p) => { need(p.script, "script"); p.script = script; })));
}));

// ---------- process 4: scenes ----------
app.post("/api/projects/:id/scenes", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const scenes = await P.decomposeScript(need(p0.script, "script"), need(p0.voiceStyle, "voice style"));
  res.json(view(await store.update(p0.id, (p) => {
    p.scenes = scenes.map((text) => ({ script: { text, history: [] }, visualPrompt: { text: "", history: [] }, clipHistory: [] }));
    for (const k of ["paperScreenshot", "creditScene", "creditClip", "finalVideo", "approvedClips"] as const) delete p[k];
  })));
}));

app.post("/api/projects/:id/visual-prompts", h(async (req, res) => {
  const p0 = await store.load(id(req));
  const scenes = need(p0.scenes, "scenes");
  const prompts = await P.generateVisualPrompts(scenes.map((s) => s.script.text), need(p0.voiceStyle, "voice style"));
  res.json(view(await store.update(p0.id, (p) => p.scenes!.forEach((s, i) => {
    if (s.visualPrompt.text) s.visualPrompt.history.push(s.visualPrompt.text);
    s.visualPrompt.text = prompts[i];
  }))));
}));

/** Run the render chain for one scene in the background and store the clip (new or replacement). */
async function renderInBackground(pid: string, index: number, variation?: RegenerationRequest, before?: () => Promise<void>) {
  setStatus(pid, index, "rendering");
  try {
    await before?.();
    const p = await store.load(pid);
    const scene = need(p.scenes?.[index], "scene");
    const clip = await P.renderScene({
      projectId: pid,
      index,
      sceneScript: scene.script.text,
      visualPrompt: need(scene.visualPrompt.text || null, "visual prompt"),
      voiceStyle: need(p.voiceStyle, "voice style"),
      variation,
    });
    const { usedFallback, ...stored } = clip;
    await store.update(pid, (p) => {
      const s = p.scenes![index];
      if (s.clip) s.clipHistory.push(s.clip); // [tool_1 modify]: replace, keep the earlier clip
      s.clip = stored;
    });
    setStatus(pid, index, usedFallback ? "warning: visual generator failed, placeholder frame used" : null);
  } catch (e) {
    console.error(`[render] scene ${index + 1}:`, e);
    setStatus(pid, index, `error: ${(e as Error).message}`);
  }
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

function isBusy(pid: string, index: number) {
  return sceneStatus.get(pid)?.[index] === "rendering";
}

/** [human specify] scene_request_1 ("all" | scene index) → model_3, tool_1, model_2, tool_2 */
app.post("/api/projects/:id/render", h(async (req, res) => {
  const pid = id(req);
  const p = await store.load(pid);
  const scenes = need(p.scenes, "scenes");
  need(p.voiceStyle, "voice style");
  if (scenes.some((s) => !s.visualPrompt.text)) throw Object.assign(new Error("generate visual prompts first"), { status: 400 });
  const request = req.body.sceneRequest;
  const indices = request === "all" ? scenes.map((_, i) => i) : [Number(request)].filter((i) => Number.isInteger(i) && i >= 0 && i < scenes.length);
  need(indices.length ? indices : null, "scene request");
  const todo = indices.filter((i) => !isBusy(pid, i));
  todo.forEach((i) => setStatus(pid, i, "rendering"));
  void pool(todo, Number(process.env.RENDER_CONCURRENCY ?? 3), (i) => renderInBackground(pid, i));
  res.json(view(p));
}));

// ---------- process 5: select scene + regeneration request ----------
app.post("/api/projects/:id/scenes/:index/regenerate", h(async (req, res) => {
  const pid = id(req);
  const index = Number(req.params.index);
  const request = req.body.regenerationRequest as RegenerationRequest;
  if (!REGENERATION_REQUESTS.includes(request)) throw Object.assign(new Error("invalid regeneration request"), { status: 400 });
  const p = await store.load(pid);
  need(p.scenes?.[index]?.clip, "existing clip for this scene");
  if (isBusy(pid, index)) throw Object.assign(new Error("scene is already rendering"), { status: 409 });
  void renderInBackground(pid, index, request);
  res.json(view(await store.load(pid)));
}));

// ---------- process 6: human modify scene script → new prompt → re-render ----------
app.post("/api/projects/:id/scenes/:index/revise", h(async (req, res) => {
  const pid = id(req);
  const index = Number(req.params.index);
  const text = String(req.body.text ?? "").trim();
  need(text || null, "scene script");
  if (isBusy(pid, index)) throw Object.assign(new Error("scene is already rendering"), { status: 409 });
  const p = await store.update(pid, (p) => {
    const s = need(p.scenes?.[index], "scene");
    if (s.script.text !== text) { s.script.history.push(s.script.text); s.script.text = text; } // scene_scripts_1 → _2
  });
  void renderInBackground(pid, index, undefined, async () => {
    const cur = await store.load(pid);
    const scenes = cur.scenes!;
    const prompt = await P.regenerateVisualPrompt(scenes.map((s) => s.script.text), scenes.map((s) => s.visualPrompt.text), index);
    await store.update(pid, (p) => { // visual_prompts_1 → _2
      const s = p.scenes![index];
      s.visualPrompt.history.push(s.visualPrompt.text);
      s.visualPrompt.text = prompt;
    });
  });
  res.json(view(p));
}));

/** Revert a scene to an earlier clip (keeps compare/revert possible across loop rounds). */
app.post("/api/projects/:id/scenes/:index/revert", h(async (req, res) => {
  const index = Number(req.params.index);
  const which = Number(req.body.historyIndex);
  res.json(view(await store.update(id(req), (p) => {
    const s = need(p.scenes?.[index], "scene");
    const old = need(s.clipHistory[which], "history clip");
    s.clipHistory.splice(which, 1);
    if (s.clip) s.clipHistory.push(s.clip);
    s.clip = old;
  })));
}));

// ---------- process 7: credits and final merge ----------
app.post("/api/projects/:id/credits/extract", h(async (req, res) => {
  const pid = id(req);
  const p0 = await store.load(pid);
  const paper = need(p0.paper, "paper");
  const shot = store.mediaPath(pid, store.uniqueName("paper-screenshot", "png"));
  const pdf = paper.pdfFile ? store.mediaFile(paper.pdfFile) : undefined;
  await paperScreenshot({ pdf, title: paper.title, outPng: shot.file });
  const authors = extractAuthors(paper.text, paper.title, pdf ? (await pdfInfo(pdf)).Author : undefined);
  res.json(view(await store.update(pid, (p) => {
    p.paperScreenshot = shot.url;
    p.paperAuthors = authors;
    p.creditText = composeCreditText(paper.title, authors); // credit_text_1
    delete p.creditScene;
  })));
}));

app.post("/api/projects/:id/credits/scene", h(async (req, res) => {
  const pid = id(req);
  const creditText = String(req.body.creditText ?? "").trim(); // credit_text_2 (human modified)
  need(creditText || null, "credit text");
  const p0 = await store.load(pid);
  const out = store.mediaPath(pid, store.uniqueName("credit-scene", "png"));
  await composeCreditScene(store.mediaFile(need(p0.paperScreenshot, "paper screenshot")), creditText, out.file);
  res.json(view(await store.update(pid, (p) => { p.creditText = creditText; p.creditScene = out.url; })));
}));

app.post("/api/projects/:id/final", h(async (req, res) => {
  const pid = id(req);
  const approved = (req.body.approvedClips as unknown[] ?? []).map(Number);
  const merge = req.body.mergeRequest as MergeRequest;
  if (!MERGE_REQUESTS.includes(merge)) throw Object.assign(new Error("invalid merge request"), { status: 400 });
  const p0 = await store.load(pid);
  const scenes = need(p0.scenes, "scenes");
  const clips = approved.filter((i) => scenes[i]?.clip).sort((a, b) => a - b);
  need(clips.length ? clips : null, "approved clips");
  const creditClip = store.mediaPath(pid, store.uniqueName("credit-clip", "mp4"));
  await stillToClip(store.mediaFile(need(p0.creditScene, "credit scene")), 4, creditClip.file); // [tool_2 translate]
  const sceneFiles = clips.map((i) => store.mediaFile(scenes[i].clip!.clip));
  const ordered = merge === "credit_start" ? [creditClip.file, ...sceneFiles] : [...sceneFiles, creditClip.file];
  const final = store.mediaPath(pid, store.uniqueName("final-video", "mp4"));
  await concatClips(ordered, final.file); // [tool_2 compose]
  res.json(view(await store.update(pid, (p) => {
    p.approvedClips = clips;
    p.mergeRequest = merge;
    p.creditClip = creditClip.url;
    p.finalVideo = final.url;
  })));
}));

// ---------- static ----------
app.get("/media/:id/:name", h(async (req, res) => {
  res.sendFile(store.mediaFile(`/media/${req.params.id}/${req.params.name}`));
}));
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (!err.status) console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => console.log(`server on http://localhost:${port}`));
server.requestTimeout = 0;
server.headersTimeout = 0;
