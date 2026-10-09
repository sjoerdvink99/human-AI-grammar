import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, listProjects, loadProject, projectDir, runJob, saveProject } from './store.ts';
import { readPaper } from './tools.ts';
import {
  composeVoiceStyle, generateScenes, maybePrepareCredits, mergeFinal, prepareCredits, prepareStoryboard, regenerateScene,
  restoreClip, reviseScene, runProcess1, selectScript, suggestTone, updateCreditText,
} from './pipeline.ts';
import { OPTION_COUNT, SCENE_COUNT, type Project, type ScriptRecord } from './types.ts';

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ dest: path.join(DATA_DIR, '..', 'uploads'), limits: { fileSize: 60 * 1024 * 1024 } });

/** Serialize a project for the browser: file paths become /media URLs. */
function view(p: Project) {
  return JSON.parse(JSON.stringify(p, (k, v) => {
    if (k === 'text' && typeof v === 'string' && v.length > 2000) return undefined; // paper text is large
    if (typeof v === 'string' && v.startsWith(DATA_DIR + path.sep)) return '/media/' + path.relative(DATA_DIR, v).split(path.sep).join('/');
    return v;
  }));
}

function getProject(req: express.Request, res: express.Response): Project | null {
  const p = loadProject(String(req.params.id));
  if (!p) res.status(404).json({ error: 'Project not found' });
  return p;
}

const wrap = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try { await fn(req, res); } catch (e: any) { res.status(400).json({ error: e.message }); }
};

app.use('/media', express.static(DATA_DIR));

app.get('/api/projects', (_req, res) => {
  res.json(listProjects().map((p) => ({ id: p.id, title: p.paper.title, createdAt: p.createdAt, hasVideo: !!p.finalVideoFile })));
});

app.get('/api/projects/:id', (req, res) => { const p = getProject(req, res); if (p) res.json(view(p)); });

// ---- process 1: upload paper -> hooks and scripts (starts automatically after upload)
app.post('/api/projects', upload.single('paper'), wrap(async (req, res) => {
  if (!req.file) throw new Error('Upload a PDF in the "paper" field');
  const id = crypto.randomUUID().slice(0, 8);
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const pdf = path.join(dir, 'paper.pdf');
  fs.renameSync(req.file.path, pdf);
  let paper;
  try { paper = await readPaper(pdf, req.file.originalname); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  const p: Project = { id, createdAt: new Date().toISOString(), paper, busy: null, error: null };
  saveProject(p);
  runJob(p, 'Generating hooks and scripts', (stage) => runProcess1(p, stage));
  res.json(view(p));
}));

app.post('/api/projects/:id/scripts/regenerate', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  runJob(p, 'Generating hooks and scripts', (stage) => runProcess1(p, stage));
  res.json(view(p));
}));

// ---- process 2: choose script and voiceover style
app.post('/api/projects/:id/select-script', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  const option = Number(req.body.option);
  if (!p.scriptOptions || !(option >= 0 && option < OPTION_COUNT)) throw new Error('Invalid option');
  if (p.busy) throw new Error(`Busy: ${p.busy.task}`);
  selectScript(p, option);
  runJob(p, 'Suggesting a voiceover tone', async () => { p.toneSuggestion = await suggestTone(p); });
  res.json(view(p));
}));

app.post('/api/projects/:id/tone/suggest', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.script) throw new Error('Choose a script first');
  runJob(p, 'Suggesting a voiceover tone', async () => { p.toneSuggestion = await suggestTone(p); });
  res.json(view(p));
}));

app.post('/api/projects/:id/voice-style', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  const pref = String(req.body.tonePreference ?? '').trim();
  if (!p.script || !pref) throw new Error('Accept the suggested tone or write your own');
  p.tonePreference = pref;
  runJob(p, 'Composing the voice style', async (stage) => {
    p.voiceStyle = await composeVoiceStyle(p);
    // process 4 trigger: once script and voice style are set, prepare the storyboard.
    if (!p.scenes) { saveProject(p); await prepareStoryboard(p, stage); }
  });
  res.json(view(p));
}));

// ---- process 3: refine the script
function validScript(s: any): s is ScriptRecord {
  return s && typeof s.hook === 'string' && typeof s.title === 'string' && Array.isArray(s.scenes) && s.scenes.length === SCENE_COUNT
    && s.scenes.every((x: unknown) => typeof x === 'string' && x.trim());
}
app.put('/api/projects/:id/script', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.script) throw new Error('Choose a script first');
  if (!validScript(req.body.script)) throw new Error(`A script needs a title, a hook and ${SCENE_COUNT} non-empty scenes`);
  p.script = req.body.script; saveProject(p); res.json(view(p));
}));
app.post('/api/projects/:id/script/revert', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  p.script = structuredClone(p.originalScript!); saveProject(p); res.json(view(p));
}));

// ---- process 4: storyboard and clips
app.post('/api/projects/:id/storyboard', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.script || !p.voiceStyle) throw new Error('Set the script and voice style first');
  if (p.scenes?.some((s) => s.status === 'working')) throw new Error('Wait for scene generation to finish');
  runJob(p, 'Preparing the storyboard', (stage) => prepareStoryboard(p, stage));
  res.json(view(p));
}));

app.post('/api/projects/:id/scenes/generate', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.scenes) throw new Error('No storyboard yet');
  const which = req.body.scene === 'all' || req.body.scene === undefined ? 'all' : Number(req.body.scene);
  if (which !== 'all' && !p.scenes[which]) throw new Error('No such scene');
  generateScenes(p, which);
  res.json(view(p));
}));

// ---- process 5: regenerate a scene
app.post('/api/projects/:id/scenes/:index/regenerate', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  const i = Number(req.params.index);
  if (!p.scenes?.[i]) throw new Error('No such scene');
  regenerateScene(p, i);
  res.json(view(p));
}));

// ---- process 6: revise a storyboard scene
app.put('/api/projects/:id/scenes/:index/script', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  const i = Number(req.params.index);
  const text = String(req.body.script ?? '').trim();
  if (!p.scenes?.[i]) throw new Error('No such scene');
  if (!text) throw new Error('Scene script cannot be empty');
  reviseScene(p, i, text);
  res.json(view(p));
}));

app.post('/api/projects/:id/scenes/:index/restore', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  restoreClip(p, Number(req.params.index), Number(req.body.version));
  saveProject(p); res.json(view(p));
}));

// ---- process 7: credits and final merge
app.post('/api/projects/:id/credits/prepare', wrap(async (req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.scenes) throw new Error('No storyboard yet');
  await prepareCredits(p); saveProject(p); res.json(view(p));
}));

app.put('/api/projects/:id/credits', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.credits) throw new Error('Credits are not prepared yet');
  updateCreditText(p, String(req.body.creditText ?? '')); saveProject(p); res.json(view(p));
}));

app.post('/api/projects/:id/merge', wrap((req, res) => {
  const p = getProject(req, res); if (!p) return;
  if (!p.credits?.creditSceneFile) throw new Error('Prepare the credit scene first');
  const approved: number[] = Array.isArray(req.body.approved) ? req.body.approved.map(Number) : [];
  if (p.scenes!.some((s) => s.status === 'working')) throw new Error('Wait for scene generation to finish');
  runJob(p, 'Merging the final video', (stage) => mergeFinal(p, approved, stage));
  res.json(view(p));
}));

// Production: serve the built frontend.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Re-check the credits trigger for projects whose clips finished before a restart.
for (const p of listProjects()) maybePrepareCredits(p);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
