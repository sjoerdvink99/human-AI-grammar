import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateScene, modifySubtree } from './operations';
import type { GenerationInput, ScopedInput } from '../shared/compose';

const app = express();
app.use(express.json({ limit: '2mb' }));

const wrap =
  (fn: (body: any) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await fn(req.body));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: (e as Error).message });
    }
  };

// Processes 1 and 6: [model generate]~
app.post('/api/generate', wrap(async (input: GenerationInput) => {
  if (!input?.prompt) throw new Error('prompt is required');
  return { scene: await generateScene(input) };
}));

// Process 5: [model modify]~
app.post('/api/modify-subtree', wrap(async (input: ScopedInput) => {
  if (!input?.request || !input?.subtree) throw new Error('request and subtree are required');
  return { subtree: await modifySubtree(input) };
}));

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`server on http://localhost:${port}`));
