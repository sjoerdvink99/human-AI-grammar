import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from './render.js';
import { estimateEnergy, computeSavings } from './energy.js';
import { generateCode } from './generator.js';
import { optimizeCode, OPTIMIZER_MODEL } from './optimizer.js';
import { diffForUi, applyEdits } from './diff.js';
import { runTraining, loadOptimizerWeights, loadTrainingWebpages } from './training.js';
import { MODEL_CHOICES } from './model.js';
import { STRATEGIES } from './strategies.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req.body ?? {}, req));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
};

app.get('/api/config', wrap(async () => ({
  modelChoices: MODEL_CHOICES,
  optimizerModel: OPTIMIZER_MODEL,
  strategies: STRATEGIES.map(({ id, description }) => ({ id, description })),
  weights: await loadOptimizerWeights(),
  trainingPages: (await loadTrainingWebpages()).length,
})));

// Process 2: model_1 generate~
app.post('/api/generate', wrap(async ({ request, model }) => ({ code: await generateCode({ request, model }) })));

// Process 3: tool_1 execute -> tool_2 evaluate (rendering + energy of one code version)
app.post('/api/render', wrap(async ({ code }) => {
  if (!code) throw new Error('code is empty');
  const png = await renderHtml(code);
  return { rendering: `data:image/png;base64,${png.toString('base64')}`, energy: estimateEnergy(png) };
}));

// Process 3: model_2 modify~ (uses the trained optimizer_weights_1)
app.post('/api/optimize', wrap(async ({ code, energyBefore }) => ({
  code: await optimizeCode({ code, energyBefore, weights: await loadOptimizerWeights() }),
})));

// Process 3: tool_5 evaluate + tool_5 extract
app.post('/api/compare', wrap(async ({ code1, code2, energyBefore, energyAfter }) => ({
  savings: computeSavings(energyBefore, energyAfter),
  diff: diffForUi(code1, code2),
})));

// Process 3: tool_5 modify (apply selected_edits_1)
app.post('/api/apply', wrap(async ({ code1, code2, selectedEdits }) => ({
  code: applyEdits(code1, code2, selectedEdits ?? []),
})));

// Process 1: training, streamed as server-sent events
let training = false;
app.get('/api/train', async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (training) {
    send('error', { error: 'training already running' });
    return res.end();
  }
  training = true;
  try {
    const result = await runTraining({ onProgress: (p) => send('progress', p) });
    send('done', {
      weights: result.optimizer_weights_1,
      pairs: result.candidate_training_pairs_1.map(({ pageId, strategies, before, after, savings }) => ({
        pageId, strategies, before: before.mW, after: after.mW, savings,
        selected: result.training_pairs_1.some((t) => t.pageId === pageId && t.strategies.join() === strategies.join()),
      })),
    });
  } catch (e) {
    console.error(e);
    send('error', { error: e.message });
  } finally {
    training = false;
    res.end();
  }
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => console.log(`System X running at http://localhost:${port}`));
server.requestTimeout = 0; // model steps can take several minutes
server.headersTimeout = 0;
