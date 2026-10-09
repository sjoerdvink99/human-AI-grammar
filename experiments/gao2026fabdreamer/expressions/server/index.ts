import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { jobs, publicState, resetProject, save, startJob, state, undoCanvas, commitCanvas, type JobCtx } from './store.ts';
import * as P from './processes.ts';
import { runLayerPipeline } from './pipeline.ts';
import { canvasSummary, evaluateConstraints, executeFix, validateFixCall } from './constraints.ts';
import * as ops from './ops.ts';
import { composeZip, translateLayers } from './exporter.ts';
import { modelLog } from './model.ts';
import { DEFAULT_MATERIAL, type MaterialSettings } from '../shared/types.ts';

const app = express();
app.use(express.json({ limit: '20mb' }));

const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
const job = (kind: string, run: (ctx: JobCtx) => Promise<unknown>) => startJob(kind, async (ctx) => void (await run(ctx)));
const str = (v: unknown, name: string) => {
  const s = z.string().trim().min(1, `${name} is required`).max(4000).parse(v);
  return s;
};

app.get('/api/state', wrap(() => publicState()));
app.post('/api/reset', wrap(() => resetProject()));
app.get('/api/jobs/:id', wrap((req) => jobs.get(String(req.params.id)) ?? { status: 'error', error: 'unknown job', steps: [] }));
app.get('/api/modellog', wrap(() => modelLog.slice(-100)));

// Process 1
app.post('/api/images/generate', wrap((req) => job('p1', (ctx) => P.p1Generate(ctx, str(req.body.prompt, 'prompt')))));
app.post('/api/images/select', wrap((req) => (P.p1Select(str(req.body.id, 'id')), save())));
// Process 2
app.post('/api/images/modify', wrap((req) => job('p2', (ctx) => P.p2Modify(ctx, str(req.body.update, 'update')))));
app.post('/api/images/revert', wrap((req) => (P.p2Revert(str(req.body.id, 'id')), save())));
// Process 3
app.post('/api/plan/generate', wrap(() => job('p3', (ctx) => P.p3Generate(ctx))));
app.post('/api/plan/modify', wrap((req) => job('p3', (ctx) => P.p3Modify(ctx, str(req.body.change, 'change')))));
// Process 4 (+5, +7 compose)
app.post('/api/build', wrap((req) => job('p4', (ctx) => runLayerPipeline(ctx, z.array(z.string()).min(1).parse(req.body.layerIds)))));
// Process 6
app.post('/api/grab/generate', wrap((req) => job('p6', (ctx) => P.p6Generate(ctx, str(req.body.request, 'request')))));
app.post('/api/grab/select', wrap((req) => job('p6', (ctx) => P.p6Select(ctx, str(req.body.id, 'id')))));
// Process 7
app.post('/api/canvas/op', wrap((req) => P.p7Modify(req.body)));
app.post('/api/canvas/undo', wrap(() => undoCanvas()));
// Process 8
app.post('/api/canvas/repair', wrap((req) => job('p8', (ctx) => P.p8Repair(ctx, str(req.body.segmentId, 'segmentId')))));
// Process 9
app.post('/api/canvas/split', wrap((req) => job('p9', (ctx) => P.p9Split(ctx, str(req.body.segmentId, 'segmentId'), str(req.body.request, 'request')))));

// Process 10
const materialSchema = z.object({
  material: z.enum(['cardstock', 'plywood', 'acrylic', 'mdf', 'felt']),
  thicknessMm: z.coerce.number().positive().max(20),
  artworkWidthMm: z.coerce.number().min(20).max(2000),
  sheetWidthMm: z.coerce.number().min(20).max(3000),
  sheetHeightMm: z.coerce.number().min(20).max(3000),
  minFeatureMm: z.coerce.number().min(0.1).max(20),
  minPartAreaMm2: z.coerce.number().min(0).max(1000),
  maxLayers: z.coerce.number().int().min(1).max(30),
});
app.put('/api/material', wrap((req) => {
  state.materialSettings = materialSchema.parse({ ...DEFAULT_MATERIAL, ...req.body }) as MaterialSettings;
  save();
}));

async function checkAndReport(ctx: JobCtx) {
  const canvas = state.canvas;
  if (!canvas) throw new Error('No canvas');
  const issues = await ctx.step('P10 [tool_3 evaluate] canvas_1 + material_settings_1 → constraint_issues_1*', () => evaluateConstraints(canvas, state.materialSettings), (i) => `${i.length} issues`);
  state.constraintIssues = issues;
  state.constraintReport = undefined;
  const report = await ctx.step('P10 [model_4 generate]~ → constraint_report_1', () => ops.generateConstraintReport(issues, state.materialSettings, canvasSummary(canvas, state.materialSettings)));
  state.constraintReport = report;
}
app.post('/api/check', wrap(() => job('p10', checkAndReport)));
app.post('/api/fix', wrap((req) => {
  const { issueId, optionId } = z.object({ issueId: z.string(), optionId: z.string() }).parse(req.body);
  return job('p10', async (ctx) => {
    const issue = state.constraintIssues.find((i) => i.id === issueId);
    const option = issue?.options.find((o) => o.id === optionId);
    if (!issue || !option || !state.canvas) throw new Error('Unknown issue or option — re-run the check');
    ctx.note('P10 [human select] → resolution_1', option.label);
    const canvas = state.canvas;
    const call = await ctx.step('P10 [model_4 translate] resolution_1 → fix_call_1', async () => {
      const c = await ops.translateResolution(issue, option, state.materialSettings, canvasSummary(canvas, state.materialSettings));
      if (c.tool !== option.tool) c.tool = option.tool; // enforce the chosen resolution's tool
      validateFixCall(c, canvas);
      return c;
    }, (c) => `${c.tool}(${JSON.stringify(c.args)})`);
    state.lastFixCall = call;
    await ctx.step('P10 [tool_3 execute] fix_call_1 → canvas_1', () => commitCanvas(executeFix(call, canvas, state.materialSettings), `fix: ${option.label}`));
    // loop back: re-check the updated canvas
    await checkAndReport(ctx);
  });
}));

// Process 11
app.get('/api/export/layers', wrap(() => {
  if (!state.canvas) throw new Error('No canvas');
  return translateLayers(state.canvas, state.materialSettings).map((l) => ({ ...l, png: 'data:image/png;base64,' + l.png.toString('base64') }));
}));
app.get('/api/export/zip', wrap(async (req, res) => {
  if (!state.canvas) throw new Error('No canvas');
  const choice = z.enum(['svg', 'png', 'both']).parse(req.query.choice ?? 'both');
  const buf = await composeZip(translateLayers(state.canvas, state.materialSettings), choice, state.materialSettings, state.canvas.version);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="layers-${choice}-v${state.canvas.version}.zip"`);
  res.end(buf);
}));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: msg });
});

const dist = join(process.cwd(), 'dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 18923);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
