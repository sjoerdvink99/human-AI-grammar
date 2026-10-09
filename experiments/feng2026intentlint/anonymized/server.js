import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractProfile, composeLibrary, validateGuideline } from './src/tools.js';
import { matchGuidelines, refineRequest, generateCode, suggestGuidelines } from './src/steps.js';
import { loadLibrary, saveLibrary } from './src/library.js';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '6mb' }));
app.use(express.static(join(ROOT, 'public')));
app.use('/vendor/hljs', express.static(join(ROOT, 'node_modules/@highlightjs/cdn-assets')));
app.use('/samples', express.static(join(ROOT, 'data/samples')));

const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req.body || {}, req));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || String(e) });
  }
};
const requireText = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  return v.trim();
};

// ---- Process 1 -----------------------------------------------------------
// tool_1 extract: r1 -> r4
app.post('/api/extract', route(({ r1 }) => ({ r4: extractProfile(r1) })));
// model_1 match: r4 + r2_1* + r3_1 -> r5*
app.post('/api/match', route(async ({ r4, r3_1 }) => {
  const r2 = await loadLibrary();
  return { r5: await matchGuidelines({ r4, r2, r3: requireText(r3_1, 'Request') }) };
}));
// model_2 modify~: r4 + r2_1* + r3_1 + r5* -> r3_2 + r6*
app.post('/api/refine', route(async ({ r4, r3_1, r5 }) => {
  const r2 = await loadLibrary();
  return refineRequest({ r4, r2, r3: requireText(r3_1, 'Request'), r5: r5 || [] });
}));
// model_4 generate~: r3_2 -> r7
app.post('/api/generate-code', route(async ({ r3_2 }) => ({ r7: await generateCode({ r3: requireText(r3_2, 'Refined request') }) })));

// ---- Process 2 -----------------------------------------------------------
// model_3 generate~: r3_1 + r4 + r5* + r2_1* -> r8*
app.post('/api/suggest', route(async ({ r3_1, r4, r5 }) => {
  const r2 = await loadLibrary();
  return { r8: await suggestGuidelines({ r3: requireText(r3_1, 'Request'), r4, r5: r5 || [], r2 }) };
}));
// tool_2 compose: r9* + r2_1* -> r2_2*
app.post('/api/compose', route(async ({ r9 }) => {
  if (!Array.isArray(r9) || !r9.length) throw new Error('Select at least one suggestion');
  const { library, added } = composeLibrary(await loadLibrary(), r9.map(validateGuideline));
  await saveLibrary(library);
  return { r2: library, added };
}));

// ---- Process 3 / 4: the library (r2) ---------------------------------------
app.get('/api/library', route(async () => ({ r2: await loadLibrary() })));
app.post('/api/library', route(async (body) => {
  const lib = await loadLibrary();
  const g = { id: `g_${randomUUID().slice(0, 8)}`, ...validateGuideline(body), source: 'user', updatedAt: new Date().toISOString() };
  return { r2: await saveLibrary([...lib, g]) };
}));
app.put('/api/library/:id', route(async (body, req) => {
  const lib = await loadLibrary();
  const i = lib.findIndex((g) => g.id === req.params.id);
  if (i < 0) throw new Error('Guideline not found');
  lib[i] = { ...lib[i], ...validateGuideline(body), updatedAt: new Date().toISOString() };
  return { r2: await saveLibrary(lib) };
}));
app.delete('/api/library/:id', route(async (_b, req) => {
  const lib = await loadLibrary();
  return { r2: await saveLibrary(lib.filter((g) => g.id !== req.params.id)) };
}));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
