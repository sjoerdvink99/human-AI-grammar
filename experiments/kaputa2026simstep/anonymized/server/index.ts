import express from 'express';
import path from 'node:path';
import { callModel } from './llm';
import { OPS, SYSTEM } from './ops';

const app = express();
app.use(express.json({ limit: '5mb' }));

// POST /api/op/:name — run one model operation of the design with validation and one retry.
app.post('/api/op/:name', async (req, res) => {
  const op = OPS[req.params.name];
  if (!op) return res.status(404).json({ error: `unknown operation ${req.params.name}` });
  const input = req.body ?? {};
  let prompt = op.prompt(input);
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callModel({ system: SYSTEM, prompt, schema: op.schema });
      const result = op.post(raw, input);
      console.log(`[op] ${req.params.name} ok in ${Date.now() - started} ms (attempt ${attempt})`);
      return res.json({ result });
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`[op] ${req.params.name} attempt ${attempt} failed: ${msg}`);
      if (attempt === 2) return res.status(502).json({ error: msg });
      prompt += `\n\nYour previous answer was rejected: ${msg}\nFix this and answer again.`;
    }
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
