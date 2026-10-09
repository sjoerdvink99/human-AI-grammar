import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  model1GenerateIkebana,
  model1GeneratePosterImages,
  model1GenerateRender,
  model1InpaintRender,
  model2GeneratePosterText,
} from './models.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

function route<Req, Res>(url: string, fn: (req: Req) => Promise<Res>) {
  app.post(url, async (req, res) => {
    const t0 = Date.now();
    try {
      const out = await fn(req.body as Req);
      console.log(`${url} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      res.json(out);
    } catch (e) {
      console.error(`${url} failed:`, e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// process 1
route('/api/model_1/generate-render', model1GenerateRender);
route('/api/model_1/inpaint-render', model1InpaintRender);
// process 2
route('/api/model_1/generate-ikebana', model1GenerateIkebana);
// process 3
route('/api/model_2/generate-poster-text', model2GeneratePosterText);
route('/api/model_1/generate-poster-images', model1GeneratePosterImages);

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
}

const port = Number(process.env.PORT ?? 8790);
app.listen(port, () => console.log(`System X model server on http://localhost:${port}`));
