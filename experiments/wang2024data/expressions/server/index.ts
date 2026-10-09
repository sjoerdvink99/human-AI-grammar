import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeDerivationPrompts, generateCodeCandidates } from './derive.ts';
import { applyDerivation, evaluateCandidates } from './sandbox.ts';
import type { Concept, DerivationRequest, Table } from '../src/shared/types.ts';

const app = express();
app.use(express.json({ limit: '20mb' }));

function validRequest(r: unknown): r is DerivationRequest {
  const d = r as DerivationRequest;
  return !!d && typeof d.name === 'string' && d.name.trim() !== '' && typeof d.description === 'string' &&
    d.description.trim() !== '' && Array.isArray(d.sourceConcepts);
}

/**
 * Processes 3 and 4, model part:
 * [tool_1 compose] -> [model generate]~ -> [tool_1 evaluate]
 */
app.post('/api/derive/candidates', async (req, res) => {
  const { table, concepts, request } = req.body as { table: Table; concepts: Concept[]; request: DerivationRequest };
  if (!table?.rows || !validRequest(request)) return res.status(400).json({ error: 'need table and a derivation request with name and description' });
  try {
    const prompts = composeDerivationPrompts(request, table, concepts ?? []);
    const codes = await generateCodeCandidates(prompts);
    const candidates = evaluateCandidates(codes, table, request);
    res.json({ prompts, candidates });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** [tool_1 execute]: selected_code -> next table version. */
app.post('/api/derive/apply', (req, res) => {
  const { table, code, name } = req.body as { table: Table; code: string; name: string };
  try {
    res.json({ table: applyDerivation(code, table, name) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
