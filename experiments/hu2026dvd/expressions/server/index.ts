import express from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Project, VideoVersion } from '../shared/types';
import { extractMask, generateClip, generateScripts } from './operations';
import { loadProject, resetProject, saveProject, VIDEO_DIR } from './store';

const app = express();
app.use(express.json({ limit: '25mb' }));

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e: unknown) => {
      console.error(e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    });

app.get('/api/project', wrap(async (_req, res) => res.json(await loadProject())));

const EDITABLE: (keyof Project)[] = ['topic', 'dataFacts', 'guidelines', 'scripts', 'references', 'chartData', 'chartType', 'composites', 'currentVersionId'];
app.patch(
  '/api/project',
  wrap(async (req, res) => {
    const p = await loadProject();
    const next = { ...p } as Record<string, unknown>;
    for (const k of EDITABLE) if (k in req.body) next[k] = req.body[k];
    await saveProject(next as unknown as Project);
    res.json(next);
  }),
);
app.post('/api/project/reset', wrap(async (_req, res) => res.json(await resetProject())));

/* Process 1: [model_1 generate]~ */
app.post(
  '/api/scripts',
  wrap(async (req, res) => {
    const body = z
      .object({
        topic: z.string().min(1, 'topic is required'),
        dataFacts: z.array(z.string()),
        guidelines: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
      })
      .parse(req.body);
    res.json({ scripts: await generateScripts(body) });
  }),
);

/* Process 4: [model_2 generate]~ */
app.post('/api/clip', wrap(async (req, res) => res.json(await generateClip(req.body))));

/* Processes 6/7: [model_3 extract] */
app.post(
  '/api/mask',
  wrap(async (req, res) => {
    const body = z
      .object({
        image: z.string().startsWith('data:image/png;base64,'),
        width: z.number(),
        height: z.number(),
        point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
      })
      .parse(req.body);
    const image = Buffer.from(body.image.split(',')[1], 'base64');
    res.json(await extractMask({ ...body, image }));
  }),
);

/* Video file storage (output of tool_2 / tool_5 / tool_6 executed in the browser). */
app.post(
  '/api/files',
  express.raw({ type: ['video/*', 'application/octet-stream'], limit: '500mb' }),
  wrap(async (req, res) => {
    const mime = String(req.headers['content-type'] ?? 'video/mp4');
    const ext = mime.includes('webm') ? 'webm' : mime.includes('quicktime') ? 'mov' : 'mp4';
    const name = `${randomUUID()}.${ext}`;
    await writeFile(path.join(VIDEO_DIR, name), req.body as Buffer);
    res.json({ url: `/files/${name}`, mime });
  }),
);
app.use('/files', express.static(VIDEO_DIR));

/* tool_7 compose: append video_n to video_versions_1 */
app.post(
  '/api/versions',
  wrap(async (req, res) => {
    const p = await loadProject();
    const v: VideoVersion = {
      id: randomUUID().slice(0, 8),
      number: (p.versions.at(-1)?.number ?? 0) + 1,
      video: req.body.video,
      scripts: req.body.scripts,
      createdAt: new Date().toISOString(),
    };
    const next = { ...p, versions: [...p.versions, v], currentVersionId: v.id };
    await saveProject(next);
    res.json(next);
  }),
);

/* assessment_1 (process 3) and video_assessment_1 (process 8) */
app.patch(
  '/api/versions/:id',
  wrap(async (req, res) => {
    const p = await loadProject();
    const body = z.object({ assessment: z.string().optional(), review: z.string().optional() }).parse(req.body);
    const next = { ...p, versions: p.versions.map((v) => (v.id === req.params.id ? { ...v, ...body } : v)) };
    await saveProject(next);
    res.json(next);
  }),
);

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/files).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3747);
app.listen(port, () => console.log(`System X API on http://localhost:${port}`));
