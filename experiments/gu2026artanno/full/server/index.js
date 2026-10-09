// HTTP API + static frontend. Wires processes 1–7 to routes.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getState, save, IMAGE_DIR, findArtwork, findTask, uid, taxonomyLeaves } from './store.js';
import { prepareArtwork } from './process1.js';
import { suggestSkills, runRecommendPipeline, runReusePipeline } from './process2.js';
import * as tool4 from './logs.js';
import { chatAnswer, focusKey } from './process4.js';
import { mineBehaviors, generateSkills, matchSkills, diffSkills, updateLibrary } from './process5.js';
import { summarizeTask, integrateKnowledge } from './process6.js';
import { seed } from './seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/images', express.static(IMAGE_DIR));
const upload = multer({ dest: IMAGE_DIR, limits: { fileSize: 15 * 1024 * 1024 } });

const bg = (p) => p.catch((e) => console.error('[background]', e.message));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

app.get('/api/state', (_req, res) => res.json({ ...getState(), labels: taxonomyLeaves() }));

app.post('/api/seed', async (_req, res) => { await seed(); res.json({ ok: true }); });

// ---------- Process 1 ----------
app.post('/api/artworks', upload.single('image'), (req, res) => {
  if (!req.file || !/^image\//.test(req.file.mimetype)) return bad(res, 'image file required');
  const ext = path.extname(req.file.originalname) || '.png';
  const file = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(IMAGE_DIR, file));
  const { title = req.file.originalname, period = '', origin = '', notes = '' } = req.body;
  const a = { id: uid('art'), file, metadata: { title, period, origin, notes }, units: null, description: null, status: 'new' };
  getState().artworks.push(a); save();
  res.json(a);
});
app.delete('/api/artworks/:id', (req, res) => {
  const s = getState(); s.artworks = s.artworks.filter((a) => a.id !== req.params.id); save(); res.json({ ok: true });
});
app.post('/api/artworks/:id/prepare', (req, res) => {
  const a = findArtwork(req.params.id); if (!a) return bad(res, 'not found', 404);
  bg(prepareArtwork(a)); res.json({ ok: true });
});
app.post('/api/prepare-all', (_req, res) => {
  const todo = getState().artworks.filter((a) => a.status === 'new' || a.status === 'error');
  todo.forEach((a) => { a.status = 'queued'; }); save();
  bg((async () => { // concurrency 3
    const q = [...todo];
    await Promise.all([0, 1, 2].map(async () => { while (q.length) await prepareArtwork(q.shift()); }));
  })());
  res.json({ queued: todo.length });
});
app.put('/api/taxonomy', (req, res) => {
  const valid = (n) => n && typeof n.label === 'string' && (!n.children || (Array.isArray(n.children) && n.children.every(valid)));
  if (!valid(req.body)) return bad(res, 'taxonomy must be {label, children?: [...]}');
  getState().labelTaxonomy = req.body; save(); res.json({ ok: true });
});

// ---------- Process 2 / 7 : task, model_2 select, human select, pipeline ----------
app.post('/api/tasks', (req, res) => {
  const s = getState();
  const instruction = String(req.body.instruction || '').trim();
  if (!instruction) return bad(res, 'task instruction required');
  if (!s.artworks.some((a) => a.status === 'ready')) return bad(res, 'prepare artworks first (process 1)');
  const reuse = s.skillLibrary.version > 1 || s.knowledgeBase.version > 1;
  const task = {
    id: uid('task'), instruction, createdAt: Date.now(), pipeline: reuse ? 'reuse' : 'recommend',
    libraryVersion: s.skillLibrary.version, kbVersion: s.knowledgeBase.version,
    status: 'suggesting', steps: [], suggestedSkills: [], chosenSkills: [], clusters: [], priorityClusterIds: [],
    confirmed: {}, feedback: {}, logs: [], chat: [], learning: null,
  };
  s.tasks.push(task); save();
  bg(runSuggest(task));
  res.json(task);
});
async function runSuggest(task) {
  const st = { name: 'model_2 select · suggested skills', status: 'running', phase: 'skills', startedAt: Date.now() };
  task.steps = [st]; task.status = 'suggesting'; save();
  try { task.suggestedSkills = await suggestSkills(task); st.status = 'done'; task.status = 'choose-skills'; }
  catch (e) { st.status = 'error'; st.error = e.message; task.status = 'error'; }
  st.endedAt = Date.now(); save();
}
app.post('/api/tasks/:id/suggest', (req, res) => { const t = findTask(req.params.id); if (!t) return bad(res, 'not found', 404); bg(runSuggest(t)); res.json({ ok: true }); });

app.post('/api/tasks/:id/skills', (req, res) => { // human select → rest of the pipeline
  const t = findTask(req.params.id); if (!t) return bad(res, 'not found', 404);
  const lib = getState().skillLibrary.skills;
  const ids = (req.body.skillIds || []).filter((id) => lib.find((s) => s.id === id));
  if (!ids.length) return bad(res, 'choose at least one skill');
  t.chosenSkills = ids; t.clusters = []; t.priorityClusterIds = []; save();
  bg(t.pipeline === 'reuse' ? runReusePipeline(t) : runRecommendPipeline(t));
  res.json({ ok: true });
});

// ---------- Process 3 : human evaluate + assign → tool_4 extract ----------
app.post('/api/tasks/:id/review', (req, res) => {
  const t = findTask(req.params.id); if (!t) return bad(res, 'not found', 404);
  const { clusterId, feedback = [], labels = [], focusedAt } = req.body;
  if (!t.clusters.find((c) => c.id === clusterId)) return bad(res, 'unknown cluster');
  const leaves = taxonomyLeaves();
  const bogus = labels.filter((l) => !leaves.includes(l)); if (bogus.length) return bad(res, `labels not in taxonomy: ${bogus.join(', ')}`);
  t.feedback[clusterId] = feedback; // annotation_feedback
  t.confirmed[`cluster:${clusterId}`] = { labels, source: 'review', at: Date.now() }; // confirmed_labels_1
  const rec = tool4.extract(t, { clusterId, feedback, labels, focusedAt });
  res.json(rec);
});

// ---------- Process 4 : chat ----------
app.post('/api/tasks/:id/chat', async (req, res) => {
  const t = findTask(req.params.id); if (!t) return bad(res, 'not found', 404);
  const { focus, question } = req.body;
  if (!focus?.type || !focus?.id || !String(question || '').trim()) return bad(res, 'focus and question required');
  const round = { id: uid('q'), focus, question, status: 'thinking', at: Date.now() };
  t.chat.push(round); save();
  try { round.answer = await chatAnswer(t, focus, question); round.status = 'answered'; }
  catch (e) { round.status = 'error'; round.error = e.message; }
  save(); res.json(round);
});
app.post('/api/tasks/:id/chat/:rid/decision', (req, res) => { // human evaluate + human assign → tool_4 expand
  const t = findTask(req.params.id); const r = t?.chat.find((x) => x.id === req.params.rid);
  if (!r || r.status !== 'answered') return bad(res, 'no answered round');
  const { verdict, note = '', labels } = req.body;
  if (!['agree', 'disagree', 'unsure'].includes(verdict)) return bad(res, 'verdict must be agree|disagree|unsure');
  const leaves = taxonomyLeaves();
  if (!Array.isArray(labels) || labels.some((l) => !leaves.includes(l))) return bad(res, 'labels must be taxonomy leaves');
  const key = focusKey(r.focus);
  const labelsBefore = t.confirmed[key]?.labels || [];
  r.decision = { verdict, note, labels }; r.status = 'decided';               // chat_decision_1
  t.confirmed[key] = { labels, source: 'chat', at: Date.now() };              // confirmed_labels_2
  tool4.expand(t, { focus: r.focus, question: r.question, answer: r.answer, decision: r.decision, labelsBefore, labelsAfter: labels });
  res.json(r);
});

// ---------- Processes 5 + 6 : learning after interactions are recorded ----------
app.post('/api/tasks/:id/learn', (req, res) => {
  const t = findTask(req.params.id); if (!t) return bad(res, 'not found', 404);
  if (!t.logs.length) return bad(res, 'no recorded interactions yet');
  if (t.learning?.status === 'running') return bad(res, 'already running');
  t.learning = { status: 'running', steps: [], startedAt: Date.now() }; save();
  bg(runLearning(t));
  res.json({ ok: true });
});

async function lstep(t, name, fn) {
  const st = { name, status: 'running' }; t.learning.steps.push(st); save();
  try { const r = await fn(); st.status = 'done'; save(); return r; } catch (e) { st.status = 'error'; st.error = e.message; save(); throw e; }
}
async function runLearning(t) {
  const s = getState();
  const logs = t.logs; // interaction_logs_2
  const p5 = (async () => {
    const lib = s.skillLibrary.skills;
    const mined = t.learning.mined = await lstep(t, 'model_6 extract · mined behaviours', () => mineBehaviors(logs, lib));
    const cands = t.learning.candidates = await lstep(t, 'model_7 generate · candidate skills', () => generateSkills(mined, lib));
    const matches = t.learning.matches = await lstep(t, 'model_8 match · overlapping skills', () => matchSkills(cands, lib));
    const diffs = t.learning.differences = await lstep(t, 'model_8 evaluate · skill differences', () => diffSkills(cands, matches, lib));
    const upd = await lstep(t, 'model_8 modify · update library', () => updateLibrary(cands, diffs, lib, t.id));
    s.skillLibrary.history.push({ version: s.skillLibrary.version, skills: lib });
    s.skillLibrary.skills = upd.skills; s.skillLibrary.version += 1; t.learning.skillChanges = upd.changes; save();
  })();
  const p6 = (async () => {
    const kb = s.knowledgeBase;
    const summary = t.learning.summary = await lstep(t, 'model_9 extract · task summary', () => summarizeTask(t, kb));
    const r = await lstep(t, 'model_10 modify · integrate knowledge', () => integrateKnowledge(summary, kb, t.id));
    kb.history.push({ version: kb.version, entries: kb.entries });
    kb.entries = r.entries; kb.version += 1; t.learning.kbChanges = { added: r.added, updated: r.updated }; save();
  })();
  const out = await Promise.allSettled([p5, p6]);
  t.learning.status = out.every((o) => o.status === 'fulfilled') ? 'done' : 'error';
  t.learning.error = out.filter((o) => o.status === 'rejected').map((o) => o.reason.message).join('; ') || null;
  save();
}

// Recover from a restart mid-run.
for (const t of getState().tasks) {
  if (['suggesting', 'analysing'].includes(t.status)) { t.status = 'error'; t.steps.forEach((s) => s.status === 'running' && (s.status = 'error', s.error = 'interrupted')); }
  if (t.learning?.status === 'running') t.learning.status = 'error';
  t.chat?.forEach((r) => r.status === 'thinking' && (r.status = 'error', r.error = 'interrupted'));
}
for (const a of getState().artworks) if (['queued', 'detecting', 'describing'].includes(a.status)) a.status = 'new';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!getState().artworks.length && !getState().tasks.length) await seed();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`System X running at http://localhost:${port}`));
}
