import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKeywords, generateImage, segment, describeFragments, generateVariant } from './models.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const app = express();
app.use(express.json({ limit: '10mb' }));

const route = (fn) => async (req, res) => {
  const t0 = Date.now();
  try {
    const result = await fn(req.body || {});
    console.log(`${req.path} ok ${Date.now() - t0}ms`);
    res.json(result);
  } catch (e) {
    console.error(`${req.path} failed:`, e.message);
    res.status(500).json({ error: e.message });
  }
};

app.post('/api/keywords', route(async ({ description }) => ({ text: await generateKeywords(String(description || '')) })));
app.post('/api/image', route(async ({ prompt }) => ({ svg: await generateImage(String(prompt || '')) })));
app.post('/api/segment', route(async (b) => ({ masks: await segment(b) })));
app.post('/api/describe', route(async (b) => ({ descriptions: await describeFragments(b) })));
app.post('/api/variant', route(async (b) => ({ svg: await generateVariant(b) })));

app.use('/data', express.static(path.join(root, 'data')));
const dist = path.join(root, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
}
