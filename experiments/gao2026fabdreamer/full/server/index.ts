import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Canvas, Element, MaterialSettings, Project, SourceVersion } from '../shared/types.js';
import { autoLayout } from '../shared/autoLayout.js';
import {
  DATA_DIR,
  HttpError,
  createProject,
  filePath,
  getJob,
  getProject,
  getWorkspace,
  listProjects,
  saveProject,
  startJob,
  uid,
} from './store.js';
import { normalizeImage, saveRGBA } from './tools/raster.js';
import * as imageModel from './models/imageModel.js';
import * as vlm from './models/vlm.js';
import * as agent from './models/agent.js';
import { runDecompose } from './pipeline/decompose.js';
import { grabCandidates, grabSelect, repairElement, splitElement } from './pipeline/elementOps.js';
import { pushCanvasHistory, undoCanvas } from './pipeline/history.js';
import { checkConstraints } from './tools/constraints.js';
import { executeFix } from './tools/geometryFixes.js';
import { composeZip, renderLayerFiles, type LayerFiles } from './tools/export.js';
import sharp from 'sharp';

const app = express();
app.use(express.json({ limit: '20mb' }));

type H = (req: express.Request, res: express.Response) => Promise<unknown> | unknown;
const route = (h: H) => async (req: express.Request, res: express.Response) => {
  try {
    const r = await h(req, res);
    if (!res.headersSent) res.json(r ?? { ok: true });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    res.status(status).json({ error: (e as Error).message });
  }
};
const P = (req: express.Request) => getProject(String(req.params.id));

// ---------- projects ----------
app.get('/api/projects', route(() => listProjects()));
app.post('/api/projects', route((req) => createProject(req.body?.name || 'Untitled design')));
app.get('/api/projects/:id', route((req) => P(req)));
app.get('/api/jobs/:jobId', route((req) => getJob(String(req.params.jobId))));

async function addSourceVersion(p: Project, png: Buffer, origin: SourceVersion['origin'], extra: Partial<SourceVersion> = {}) {
  const n = await normalizeImage(png);
  const v: SourceVersion = { id: uid('s_'), file: '', width: n.width, height: n.height, origin, createdAt: Date.now(), ...extra };
  v.file = `${v.id}.png`;
  fs.writeFileSync(filePath(p.id, v.file), n.png);
  p.sourceVersions.push(v);
  p.activeSourceId = v.id;
  getWorkspace(p, v.id);
  saveProject(p);
  return v;
}

/** Process 3 trigger: given an uploaded/generated image, model_1 proposes a layer plan. */
function startProposeLayers(p: Project, sourceId: string) {
  return startJob('propose-layers', async (log) => {
    const v = p.sourceVersions.find((s) => s.id === sourceId)!;
    const ws = getWorkspace(p, sourceId);
    log('Proposing depth layers (model_1)');
    const { plan, message } = await vlm.proposeLayers(filePath(p.id, v.file), v.width, v.height);
    if (ws.layerPlan) ws.layerPlanHistory.push(ws.layerPlan);
    ws.layerPlan = plan;
    ws.planChat.push({ role: 'model', text: message });
    saveProject(p);
  });
}

// ---------- process 1 & upload ----------
app.post(
  '/api/projects/:id/upload',
  express.raw({ type: 'image/*', limit: '30mb' }),
  route(async (req) => {
    const p = P(req);
    const v = await addSourceVersion(p, req.body as Buffer, 'upload');
    return { sourceId: v.id, jobId: startProposeLayers(p, v.id).id };
  }),
);

app.post(
  '/api/projects/:id/generate',
  route((req) => {
    const p = P(req);
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) throw new HttpError(400, 'prompt required');
    p.prompt = prompt;
    p.imageCandidates = [];
    saveProject(p);
    const job = startJob('generate-candidates', async (log) => {
      log('Generating three candidate images (model_2)');
      const imgs = await imageModel.generateCandidates(prompt, 3);
      for (const img of imgs) {
        const f = `cand_${uid()}.png`;
        await saveRGBA(img, filePath(p.id, f));
        p.imageCandidates.push(f);
      }
      saveProject(p);
    });
    return { jobId: job.id };
  }),
);

app.post(
  '/api/projects/:id/candidates/select',
  route(async (req) => {
    const p = P(req);
    const f = p.imageCandidates[Number(req.body?.index)];
    if (!f) throw new HttpError(400, 'no such candidate');
    const v = await addSourceVersion(p, fs.readFileSync(filePath(p.id, f)), 'generated', { instruction: p.prompt });
    return { sourceId: v.id, jobId: startProposeLayers(p, v.id).id };
  }),
);

// ---------- process 2 ----------
app.post(
  '/api/projects/:id/refine',
  route((req) => {
    const p = P(req);
    const parent = p.sourceVersions.find((s) => s.id === (req.body?.sourceId ?? p.activeSourceId));
    const instruction = String(req.body?.instruction || '').trim();
    if (!parent || !instruction) throw new HttpError(400, 'source and instruction required');
    const job = startJob('refine-image', async (log) => {
      log('Regenerating the image with your change (model_2)');
      const img = await imageModel.editImage(filePath(p.id, parent.file), parent.width, parent.height, instruction);
      const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
        .png()
        .toBuffer();
      const v = await addSourceVersion(p, buf, 'refined', { parentId: parent.id, instruction });
      log('New version created; proposing layers for it (model_1)');
      const ws = getWorkspace(p, v.id);
      const { plan, message } = await vlm.proposeLayers(filePath(p.id, v.file), v.width, v.height);
      ws.layerPlan = plan;
      ws.planChat.push({ role: 'model', text: message });
      saveProject(p);
    });
    return { jobId: job.id };
  }),
);

app.post(
  '/api/projects/:id/active',
  route((req) => {
    const p = P(req);
    if (!p.sourceVersions.some((s) => s.id === req.body?.sourceId)) throw new HttpError(400, 'unknown version');
    p.activeSourceId = req.body.sourceId;
    getWorkspace(p);
    saveProject(p);
    return p;
  }),
);

// ---------- process 3 ----------
app.post('/api/projects/:id/plan/propose', route((req) => ({ jobId: startProposeLayers(P(req), P(req).activeSourceId!).id })));

app.post(
  '/api/projects/:id/plan/change',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const text = String(req.body?.text || '').trim();
    if (!text || !ws.layerPlan) throw new HttpError(400, 'need a plan and a change request');
    ws.planChat.push({ role: 'user', text });
    saveProject(p);
    const v = p.sourceVersions.find((s) => s.id === ws.sourceId)!;
    const job = startJob('revise-layers', async (log) => {
      log('Revising the layer plan (model_1)');
      const { plan, message } = await vlm.reviseLayers(filePath(p.id, v.file), v.width, v.height, ws.layerPlan!, text);
      ws.layerPlanHistory.push(ws.layerPlan!);
      ws.layerPlan = plan;
      ws.planChat.push({ role: 'model', text: message });
      saveProject(p);
    });
    return { jobId: job.id };
  }),
);

app.post(
  '/api/projects/:id/plan/revert',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const old = ws.layerPlanHistory[Number(req.body?.index)];
    if (!old) throw new HttpError(400, 'no such plan version');
    ws.layerPlanHistory.push(ws.layerPlan!);
    ws.layerPlan = structuredClone(old);
    ws.planChat.push({ role: 'model', text: `Reverted to plan version ${Number(req.body.index) + 1}.` });
    saveProject(p);
    return p;
  }),
);

// ---------- process 4 (+5, +7 auto layout) ----------
app.post(
  '/api/projects/:id/confirm',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    if (!ws.layerPlan) throw new HttpError(400, 'no layer plan');
    if (ws.decomposeStatus === 'running') throw new HttpError(409, 'decomposition already running');
    ws.confirmedLayers = structuredClone(ws.layerPlan);
    const job = startJob('decompose', (log) => runDecompose(p, ws, log));
    return { jobId: job.id };
  }),
);

// ---------- process 7 ----------
app.put(
  '/api/projects/:id/canvas',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const body = req.body as { canvas: Canvas; transforms: Record<string, Pick<Element, 'x' | 'y' | 'scale' | 'rotation' | 'layerId'>>; name?: Record<string, string> };
    if (!ws.canvas) throw new HttpError(400, 'no canvas yet');
    pushCanvasHistory(ws);
    const known = new Set(Object.keys(ws.elements));
    ws.canvas = {
      ...ws.canvas,
      layers: body.canvas.layers.map((l) => ({ ...l, elementIds: l.elementIds.filter((id) => known.has(id)) })),
    };
    const kept = new Set(ws.canvas.layers.flatMap((l) => l.elementIds));
    for (const id of Object.keys(ws.elements)) if (!kept.has(id)) delete ws.elements[id];
    for (const [id, t] of Object.entries(body.transforms || {})) {
      const e = ws.elements[id];
      if (!e) continue;
      Object.assign(e, { x: +t.x, y: +t.y, scale: Math.max(0.02, +t.scale), rotation: +t.rotation, layerId: t.layerId });
    }
    saveProject(p);
    return { ok: true, historyLength: ws.canvasHistory.length };
  }),
);
app.post(
  '/api/projects/:id/canvas/undo',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    if (!undoCanvas(ws)) throw new HttpError(400, 'nothing to undo');
    saveProject(p);
    return p;
  }),
);
app.post(
  '/api/projects/:id/autolayout',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    if (!ws.confirmedLayers || !ws.canvas) throw new HttpError(400, 'nothing to lay out');
    pushCanvasHistory(ws);
    const plan = { layers: ws.canvas.layers.map((l) => ({ id: l.id, name: l.name, depth: l.depth, elements: [] })) };
    ws.canvas = autoLayout(plan, ws.elements, ws.canvas.width, ws.canvas.height, ws.canvas);
    saveProject(p);
    return p;
  }),
);

// ---------- process 6 ----------
app.post(
  '/api/projects/:id/grab',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const request = String(req.body?.request || '').trim();
    if (!request) throw new HttpError(400, 'describe the object');
    return { jobId: startJob('grab-candidates', (log) => grabCandidates(p, ws, request, log)).id };
  }),
);
app.post(
  '/api/projects/:id/grab/select',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    if (!ws.canvas) throw new HttpError(400, 'decompose the image first');
    const layerId = String(req.body?.layerId || ws.canvas.layers[0].id);
    return { jobId: startJob('grab-select', (log) => grabSelect(p, ws, Number(req.body?.index), layerId, log)).id };
  }),
);

// ---------- process 8 & 9 ----------
app.post(
  '/api/projects/:id/elements/:eid/repair',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    return { jobId: startJob('repair', (log) => repairElement(p, ws, String(req.params.eid), log)).id };
  }),
);
app.post(
  '/api/projects/:id/elements/:eid/split',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const request = String(req.body?.request || '').trim();
    if (!request) throw new HttpError(400, 'say which parts to separate');
    return { jobId: startJob('split', (log) => splitElement(p, ws, String(req.params.eid), request, log)).id };
  }),
);

// ---------- process 10 ----------
app.put(
  '/api/projects/:id/material',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const m = req.body as MaterialSettings;
    ws.material = {
      material: String(m.material),
      thicknessMm: Math.max(0.05, +m.thicknessMm),
      minFeatureMm: Math.max(0.1, +m.minFeatureMm),
      sheetWidthMm: Math.max(20, +m.sheetWidthMm),
      layerGapMm: Math.max(0, +m.layerGapMm),
    };
    saveProject(p);
    return p;
  }),
);

async function checkAndExplain(p: Project, log: (s: string) => void) {
  const ws = getWorkspace(p);
  log('Checking floating parts and thin features (tool_3)');
  ws.prepare.issues = await checkConstraints(ws);
  ws.prepare.checkedAt = Date.now();
  saveProject(p);
  log(`${ws.prepare.issues.length} issue(s) found; explaining (model_4)`);
  ws.prepare.report = await agent.explainIssues(ws, ws.prepare.issues);
  ws.prepare.chat.push({ role: 'agent', text: ws.prepare.report.report });
  saveProject(p);
}

app.post(
  '/api/projects/:id/prepare/check',
  route((req) => {
    const p = P(req);
    if (!getWorkspace(p).canvas) throw new HttpError(400, 'nothing to check yet');
    return { jobId: startJob('prepare-check', (log) => checkAndExplain(p, log)).id };
  }),
);

app.post(
  '/api/projects/:id/prepare/resolve',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const opt = ws.prepare.report?.options.find((o) => o.id === req.body?.optionId);
    const text = String(req.body?.text || '').trim();
    const resolution = opt ? `${opt.label}: ${opt.description} (issues ${opt.issueIds.join(', ')})${text ? `. Also: ${text}` : ''}` : text;
    if (!resolution) throw new HttpError(400, 'choose an option or describe a fix');
    ws.prepare.chat.push({ role: 'user', text: opt ? opt.label + (text ? ` — ${text}` : '') : text });
    saveProject(p);
    const job = startJob('prepare-resolve', async (log) => {
      log('Translating your choice into geometry operations (model_4)');
      const { calls, message } = await agent.toFixCalls(ws, ws.prepare.issues, resolution);
      ws.prepare.chat.push({ role: 'agent', text: message });
      for (const call of calls) {
        try {
          const r = await executeFix(p, ws, call);
          ws.prepare.chat.push({ role: 'tool', text: r, fixCall: call });
        } catch (e) {
          ws.prepare.chat.push({ role: 'tool', text: `Failed: ${(e as Error).message}`, fixCall: call });
        }
        saveProject(p);
      }
      await checkAndExplain(p, log);
    });
    return { jobId: job.id };
  }),
);

// ---------- process 11 ----------
const renders = new Map<string, LayerFiles[]>();
app.post(
  '/api/projects/:id/export/render',
  route((req) => {
    const p = P(req);
    const ws = getWorkspace(p);
    if (!ws.canvas) throw new HttpError(400, 'nothing to export');
    const job = startJob('export-render', async (log) => {
      log('Rendering cut/engrave SVG and PNG per layer (tool_1)');
      const files = await renderLayerFiles(p, ws);
      renders.set(p.id, files);
      return files;
    });
    return { jobId: job.id };
  }),
);
app.post(
  '/api/projects/:id/export/zip',
  route(async (req, res) => {
    const p = P(req);
    const ws = getWorkspace(p);
    const files = renders.get(p.id);
    if (!files) throw new HttpError(400, 'render the layer files first');
    const formats = (req.body?.formats ?? ['svg', 'png']).filter((f: string) => f === 'svg' || f === 'png');
    const layerIds: string[] = req.body?.layerIds ?? files.map((f) => f.layerId);
    if (!formats.length || !layerIds.length) throw new HttpError(400, 'choose at least one format and layer');
    const buf = await composeZip(p, files, { formats, layerIds }, ws);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${p.name.replace(/[^\w-]+/g, '_') || 'design'}-layers.zip"`);
    res.send(buf);
  }),
);

// ---------- files & static ----------
app.get('/data/:id/:file', (req, res) => {
  const f = path.join(DATA_DIR, path.basename(req.params.id), path.basename(req.params.file));
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(f);
});

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|data).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// keep the server alive if a background step throws outside its job promise
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

// a decomposition that was running when the server stopped can't resume: mark it failed so the user can retry
for (const { id } of listProjects()) {
  const p = getProject(id);
  let changed = false;
  for (const ws of Object.values(p.workspaces))
    if (ws.decomposeStatus === 'running') {
      ws.decomposeStatus = 'error';
      ws.decomposeLog.push({ t: Date.now(), step: 'Interrupted (server restarted) — confirm the layers again to retry' });
      changed = true;
    }
  if (changed) saveProject(p);
}

const PORT = Number(process.env.PORT || 5174);
app.listen(PORT, () => console.log(`System X server on http://localhost:${PORT}`));
