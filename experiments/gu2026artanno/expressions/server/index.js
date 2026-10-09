import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { load, save, reset, getRun, newId, latestSkills, latestKB, IMAGE_DIR, CROP_DIR, DATA_DIR } from './store.js';
import { startJob, getJob, runStep } from './jobs.js';
import { providerInfo } from './llm.js';
import { runProcess1, P1_STEPS } from './processes/p1.js';
import { suggestSkills, runClustering, P2_STEPS, P7_STEPS } from './processes/p2.js';
import { commitReview } from './processes/p3.js';
import { ask, decide } from './processes/p4.js';
import { model6MineBehaviors, model7CandidateSkills, model8Match, model8Compare, model8UpdateLibrary } from './processes/p5.js';
import { model9Summarize, model10UpdateKB } from './processes/p6.js';
import { seedCollection } from './seed/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/images', express.static(IMAGE_DIR));
app.use('/crops', express.static(CROP_DIR));
const upload = multer({ dest: path.join(DATA_DIR, 'uploads') });

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
};

app.get('/api/state', wrap(() => ({ ...load(), provider: providerInfo })));
app.get('/api/jobs/:id', wrap((req) => getJob(req.params.id) || { status: 'missing' }));

// ---- collection management (inputs of process 1) ----
app.post('/api/seed', wrap(async () => { await seedCollection(); return { ok: true }; }));
app.post('/api/artworks', upload.single('image'), wrap(async (req) => {
  const s = load();
  if (!req.file) throw new Error('image file required');
  let meta;
  try { meta = JSON.parse(req.body.metadata || '{}'); } catch { throw new Error('metadata must be JSON'); }
  if (!Array.isArray(meta.objects) || !meta.objects.length) throw new Error('metadata.objects must list at least one {label, bbox:[x,y,w,h]}');
  const id = newId('art');
  const file = `${id}.png`;
  const info = await sharp(req.file.path).png().toFile(path.join(IMAGE_DIR, file));
  fs.rmSync(req.file.path, { force: true });
  s.artworks.push({ id, title: meta.title || req.file.originalname, image: `/images/${file}`, file, width: info.width, height: info.height });
  s.artworkMetadata.push({ artworkId: id, title: meta.title || req.file.originalname, artist: meta.artist || 'Unknown', year: meta.year || '', medium: meta.medium || '', objects: meta.objects });
  save();
  return { id };
}));

// ---- process 1 ----
app.post('/api/p1/run', wrap((req) => {
  const job = startJob('process 1', P1_STEPS, (j) => { j.force = !!req.body.force; return runProcess1(j); });
  return { jobId: job.id };
}));

// ---- process 2 / 7 ----
app.post('/api/runs/suggest', wrap(async (req) => {
  const { task, mode } = req.body;
  if (!task?.trim()) throw new Error('Write a task first.');
  const job = startJob(`${mode} model_2 select`, ['model_2 select'], (j) => runStep(j, 'model_2 select', () => suggestSkills({ task, mode })));
  return { jobId: job.id };
}));
app.post('/api/runs/:id/start', wrap((req) => {
  const s = load();
  const run = getRun(req.params.id, s);
  if (!run) throw new Error('unknown run');
  const lib = s.skillLibrary.versions.find((v) => v.version === run.skillLibraryVersion);
  const chosen = (req.body.chosenSkills || []).filter((id) => lib.skills.some((k) => k.id === id));
  if (!chosen.length) throw new Error('Choose at least one skill.');
  run.chosenSkills = chosen;
  // a skill the human added that model_2 did not suggest gets a generic application note
  for (const id of chosen) if (!run.suggestedSkills.some((x) => x.skillId === id)) run.suggestedSkills.push({ skillId: id, relevance: 0, reason: 'Added by curator', application: `Apply this skill to the task: ${run.task}` });
  save();
  const job = startJob(`process ${run.process}`, run.process === 2 ? P2_STEPS : P7_STEPS, (j) => runClustering(j, run.id));
  run.jobId = job.id;
  return { jobId: job.id };
}));
app.post('/api/runs/:id/activate', wrap((req) => { const s = load(); s.activeRunId = req.params.id; save(); return { ok: true }; }));

// ---- process 3 ----
app.post('/api/review/confirm', wrap((req) => commitReview(req.body)));

// ---- process 4 ----
app.post('/api/chat/ask', wrap((req) => {
  const job = startJob('model_5 generate~', ['model_5 generate~'], (j) => runStep(j, 'model_5 generate~', () => ask(req.body)));
  return { jobId: job.id };
}));
app.post('/api/chat/decide', wrap((req) => decide(req.body)));

// ---- process 5 + 6: learn from the session ----
app.post('/api/learn', wrap(() => {
  const s = load();
  const from = s.learning.at(-1)?.logCursor ?? 0;
  const logs = s.interactionLogs.slice(from);
  if (!logs.length) throw new Error('No new interaction logs since the last learning round. Review clusters or use the chat first.');
  const round = { id: newId('learn'), ts: new Date().toISOString(), logCount: logs.length, logCursor: s.interactionLogs.length, status: 'running' };
  s.learning.push(round);
  save();
  const steps = ['model_6 extract', 'model_7 generate~', 'model_8 match', 'model_8 evaluate', 'model_8 modify~', 'model_9 extract~', 'model_10 modify'];
  const job = startJob('process 5 + 6', steps, async (j) => {
    const lib = latestSkills(s), kb = latestKB(s);
    round.libraryFrom = lib.version; round.kbFrom = kb.version;
    const p5 = (async () => {
      round.minedBehaviors = await runStep(j, 'model_6 extract', () => model6MineBehaviors(logs)); save();
      round.candidateSkills = await runStep(j, 'model_7 generate~', () => model7CandidateSkills(round.minedBehaviors, lib.skills)); save();
      round.matchingSkills = await runStep(j, 'model_8 match', () => model8Match(round.candidateSkills, lib.skills)); save();
      round.skillDifferences = await runStep(j, 'model_8 evaluate', () => model8Compare(round.candidateSkills, round.matchingSkills, lib.skills)); save();
      const skills = await runStep(j, 'model_8 modify~', () => model8UpdateLibrary(round.candidateSkills, round.skillDifferences, lib.skills));
      const v = { version: s.skillLibrary.versions.length + 1, createdAt: new Date().toISOString(), skills, learningRound: round.id };
      s.skillLibrary.versions.push(v);
      round.libraryTo = v.version; save();
    })();
    const p6 = (async () => {
      round.taskSummary = await runStep(j, 'model_9 extract~', () => model9Summarize(logs, s.confirmedLabels, kb, s.labelTaxonomy)); save();
      const { entries, operations } = await runStep(j, 'model_10 modify', () => model10UpdateKB(round.taskSummary, kb));
      const v = { version: s.knowledgeBase.versions.length + 1, createdAt: new Date().toISOString(), entries, learningRound: round.id };
      s.knowledgeBase.versions.push(v);
      round.kbOperations = operations; round.kbTo = v.version; save();
    })();
    const results = await Promise.allSettled([p5, p6]);
    round.status = results.every((r) => r.status === 'fulfilled') ? 'done' : 'error';
    save();
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  });
  return { jobId: job.id };
}));

app.post('/api/reset-session', wrap(() => {
  // keep collection + descriptions, clear runs, labels, logs, learning, library/KB versions
  const s = load();
  const fresh = reset({ ...s, runs: [], activeRunId: null, annotationFeedback: [], confirmedLabels: [], confirmedLabelsVersion: 1, interactionLogs: [], interactionLogsVersion: 1, chat: [], learning: [],
    skillLibrary: { versions: [s.skillLibrary.versions[0]] }, knowledgeBase: { versions: [s.knowledgeBase.versions[0]] } });
  return { ok: !!fresh };
}));

const PORT = Number(process.env.PORT || 4317);
if (!fs.existsSync(path.join(DATA_DIR, 'state.json'))) {
  console.log('No data yet — seeding the sample collection…');
  await seedCollection();
}
load();
app.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}  (model provider: ${providerInfo.provider}/${providerInfo.model})`));
