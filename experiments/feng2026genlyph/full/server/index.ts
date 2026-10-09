import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeFragment, encodeFragment, generateImages, generateKeywords, segmentRegion } from './models.ts';

const app = express();
app.use(express.json({ limit: '20mb' }));

type Handler = (body: any) => Promise<unknown>;
function route(p: string, h: Handler) {
  app.post(p, async (req, res) => {
    const t0 = Date.now();
    try {
      const out = await h(req.body ?? {});
      console.log(`${p} ok ${Date.now() - t0}ms`);
      res.json(out);
    } catch (e) {
      console.error(`${p} failed`, e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`missing ${name}`);
  return v;
}

// P1: [model_1 generate]~ dataset_description_1 -> keyword_response_1
route('/api/keywords', async (b) => ({ keywordResponse: await generateKeywords(str(b.datasetDescription, 'datasetDescription')) }));

// P1/P2: [model_2 generate]~ image prompt -> candidate images
route('/api/images', async (b) => ({ images: await generateImages(str(b.imagePrompt, 'imagePrompt'), 3) }));

// P4: [model_3 extract] glyph_image_1 + regions_1 -> masks_1
route('/api/segment', async (b) => {
  if (!Array.isArray(b.shapes) || !Array.isArray(b.box)) throw new Error('missing shapes/box');
  return segmentRegion(str(b.svg, 'svg'), b.shapes, b.box);
});

// P5: [model_4 generate]~ fragments_1 -> fragment_descriptions_1
route('/api/describe', async (b) => ({ description: await describeFragment(str(b.png, 'png')) }));

// P5: [model_5 generate]~ encoding_prompts_1 + fragment_edges_1 -> categorical_fragments_1
route('/api/encode', async (b) => {
  if (!Array.isArray(b.edges) || !Array.isArray(b.prompts) || b.prompts.length === 0) throw new Error('missing edges/prompts');
  return { variants: await encodeFragment(b.edges, b.prompts) };
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8791);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
