import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { store } from './library.ts';
import { runProcess1 } from './process1.ts';
import { runProcess2 } from './process2.ts';
import { runProcess3 } from './process3.ts';
import { ndjsonEmitter } from './util.ts';

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/library', (_req, res) => res.json({ library: store.library(), reliability: store.reliability() }));
app.post('/api/reset', (_req, res) => { store.reset(); res.json({ ok: true }); });

/** Runs a process and streams each transformation as NDJSON; the last line is {type:"done"} or {type:"error"}. */
function streamed(run: (emit: ReturnType<typeof ndjsonEmitter>, body: any) => Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    const emit = ndjsonEmitter(res);
    try {
      const result = await run(emit, req.body);
      emit.send({ type: 'done', result });
    } catch (e) {
      console.error(e);
      emit.send({ type: 'error', message: (e as Error).message });
    }
    res.end();
  };
}

// Process 1 — trigger: "Compose scene" with request r1.
app.post('/api/process1', streamed(async (emit, body) => {
  const request = String(body?.request ?? '').trim();
  if (request.length < 3) throw new Error('Describe the scene first.');
  return runProcess1(request, store.library(), store.reliability(), emit);
}));

// Process 2 — trigger: a spoken (or typed) command on the current scene.
app.post('/api/process2', streamed(async (emit, body) => {
  const { transcript, selection, scene, layout, view } = body ?? {};
  if (!String(transcript ?? '').trim()) throw new Error('No command heard.');
  return runProcess2({ transcript, selection: selection ?? { objectIds: [] }, scene, layout, view }, emit);
}));

// Process 3 — trigger: "Learn from this scene".
app.post('/api/process3', streamed(async (emit, body) => {
  const { scene, layout, view } = body ?? {};
  if (!scene || !Array.isArray(layout)) throw new Error('No scene to learn from.');
  const result = await runProcess3({ scene, layout, view }, store.library(), store.reliability(), emit);
  store.saveLibrary(result.library);
  store.saveReliability(result.reliability);
  return result;
}));

const dist = join(process.cwd(), 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
