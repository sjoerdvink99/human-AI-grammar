import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getState, setState, save, log, pushVersion, emptyState, labelSpace, IMAGE_DIR } from './store.js';
import { tool4Extract, tool4Expand } from './tools.js';
import * as P from './pipeline.js';
import { buildDemo, DEMO_GUIDELINES, DEMO_TAXONOMY, DEMO_PROFILE, DEMO_INSTRUCTION } from './demo.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));
app.use('/images', express.static(IMAGE_DIR));

// ---- single background job at a time; the client polls /api/state ----
let job = null; // {name, error}
function run(name, fn) {
  return (req, res) => {
    if (job?.running) return res.status(409).json({ error: `busy: ${job.name}` });
    job = { name, running: true, error: null };
    Promise.resolve().then(() => fn(req)).then(
      () => { job.running = false; },
      (e) => { job.running = false; job.error = e.message; log(`ERROR in ${name}: ${e.message}`); },
    );
    res.json({ started: name });
  };
}
const ok = (fn) => (req, res) => {
  if (job?.running) return res.status(409).json({ error: `busy: ${job.name}` });
  try { fn(req); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
};

app.get('/api/state', (req, res) => res.json({ ...getState(), job, labelSpace: labelSpace() }));

// ---- dataset (inputs to process 1) ----
function resetWith({ images, annotations }) {
  const s = emptyState();
  Object.assign(s, { images, annotations });
  s.instruction = { current: DEMO_INSTRUCTION, versions: [{ v: 1, value: DEMO_INSTRUCTION, at: new Date().toISOString() }] };
  s.guidelines = { current: DEMO_GUIDELINES, versions: [{ v: 1, value: DEMO_GUIDELINES, at: new Date().toISOString() }] };
  s.profile = { current: DEMO_PROFILE, versions: [{ v: 1, value: DEMO_PROFILE, at: new Date().toISOString() }] };
  s.taxonomy = DEMO_TAXONOMY;
  setState(s);
}

app.post('/api/dataset/demo-load', run('load demo', async () => {
  fs.rmSync(IMAGE_DIR, { recursive: true, force: true });
  resetWith(await buildDemo(IMAGE_DIR));
  log('Demo dataset loaded');
}));

const upload = multer({ dest: path.join(IMAGE_DIR, '..', 'uploads') });
app.post('/api/dataset/upload', upload.fields([{ name: 'images' }, { name: 'annotations', maxCount: 1 }]), async (req, res) => {
  if (job?.running) return res.status(409).json({ error: 'busy' });
  try {
    fs.rmSync(IMAGE_DIR, { recursive: true, force: true });
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    const images = [];
    for (const f of req.files.images || []) {
      const id = path.parse(f.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = `${id}.png`;
      const meta = await sharp(f.path).png().toFile(path.join(IMAGE_DIR, file));
      images.push({ id, file, width: meta.width, height: meta.height, original: f.originalname });
      fs.rmSync(f.path, { force: true });
    }
    let annotations = images.map((i) => ({ imageId: i.id, objects: [] }));
    const annFile = req.files.annotations?.[0];
    if (annFile) {
      const raw = JSON.parse(fs.readFileSync(annFile.path, 'utf8'));
      fs.rmSync(annFile.path, { force: true });
      annotations = images.map((img) => {
        const a = raw.find((r) => r.imageId === img.id || r.file === img.original);
        return { imageId: img.id, objects: a?.objects || [] };
      });
    }
    if (!images.length) throw new Error('no images uploaded');
    resetWith({ images, annotations });
    log(`Uploaded ${images.length} images`);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- process 1 ----
app.post('/api/p1', run('P1 prepare', () => P.process1()));

// ---- process 2 ----
app.post('/api/instruction', ok((req) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw new Error('instruction is empty');
  if (text !== getState().instruction.current) pushVersion('instruction', text);
}));
app.post('/api/p2/suggest', run('P2 suggest guidelines', () => P.process2Suggest()));
app.post('/api/p2/run', run('P2 label run', (req) => {
  const ids = req.body.activeGuidelines || [];
  if (!ids.length) throw new Error('select at least one guideline');
  return P.process2Run(ids);
}));

// ---- process 3: human select (client) -> evaluate -> assign -> tool_4 extract ----
app.post('/api/p3/review', ok((req) => {
  const s = getState();
  const { imageId, verdict, comment = '', label } = req.body;
  if (!s.images.some((i) => i.id === imageId)) throw new Error('unknown image');
  if (!['agree', 'disagree'].includes(verdict)) throw new Error('verdict must be agree or disagree');
  if (!labelSpace().includes(label)) throw new Error('label not allowed');
  s.humanReviews.push({ imageId, verdict, comment, at: new Date().toISOString() }); // r23
  s.finalLabels = [...s.finalLabels.filter((l) => l.imageId !== imageId), { imageId, label }]; // r24
  s.labeledExamples = tool4Extract(s, [imageId]); // r25
  save();
  log(`P3 reviewed ${imageId}: ${verdict}, label=${label}`);
}));

// ---- process 4 ----
app.post('/api/p4/ask', run('P4 ask', async (req) => {
  const s = getState();
  const { imageId, question } = req.body;
  if (!s.images.some((i) => i.id === imageId)) throw new Error('unknown image');
  if (!String(question || '').trim()) throw new Error('question is empty');
  s.replyReview = null;
  log(`P4 model_5 generate: answering about ${imageId}`);
  s.assistantReply = await P.model5Answer(s, imageId, String(question));
  save();
}));
app.post('/api/p4/judge', ok((req) => {
  const s = getState();
  const { helpful, comment = '', label } = req.body;
  if (!s.assistantReply) throw new Error('no reply to judge');
  if (!labelSpace().includes(label)) throw new Error('label not allowed');
  const imageId = s.assistantReply.imageId;
  s.replyReview = { imageId, helpful: !!helpful, comment }; // r29
  s.finalLabels = [...s.finalLabels.filter((l) => l.imageId !== imageId), { imageId, label }]; // r24_2
  s.labeledExamples = tool4Expand(s, imageId); // r25_2
  save();
  log(`P4 judged reply for ${imageId}: helpful=${!!helpful}, label=${label}`);
}));

// ---- processes 5, 6 ----
app.post('/api/p5', run('P5 learn guidelines', () => P.process5()));
app.post('/api/p6', run('P6 update profile', () => P.process6()));

// ---- process 7 ----
app.post('/api/p7/suggest', run('P7 suggest guidelines', (req) => {
  const text = String(req.body.instruction || '').trim();
  if (!text) throw new Error('instruction is empty');
  return P.process7Suggest(text);
}));
app.post('/api/p7/run', run('P7 re-run', (req) => {
  const ids = req.body.activeGuidelines || [];
  if (!ids.length) throw new Error('select at least one guideline');
  return P.process7Run(ids);
}));

// ---- revert a versioned representation (r7, r8, r9) ----
app.post('/api/revert', ok((req) => {
  const { key, v } = req.body;
  if (!['instruction', 'guidelines', 'profile'].includes(key)) throw new Error('not revertable');
  const ver = getState()[key].versions.find((x) => x.v === v);
  if (!ver) throw new Error('no such version');
  pushVersion(key, ver.value, { revertedFrom: v });
}));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
