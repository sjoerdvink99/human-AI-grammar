// tool_1 data transformation backend.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reshape } from '../shared/synth';
import { composePrompts, generateCandidates } from './derive';
import { applyCode, evaluateCandidates } from './evaluate';
import type { ChartSpec, ConceptType, DerivationRequest, ExampleRelation, Row, Table } from '../shared/types';

const app = express();
app.use(express.json({ limit: '25mb' }));

const wrap =
  (fn: (req: express.Request) => unknown | Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  };

function validateRequest(r: DerivationRequest, rows: Row[]) {
  if (!r || !Array.isArray(r.sources) || r.sources.length === 0) throw new Error('select at least one source concept');
  if (!r.name?.trim()) throw new Error('name the new concept');
  if (!r.description?.trim()) throw new Error('describe how to compute the new concept');
  const cols = new Set(Object.keys(rows[0] ?? {}));
  for (const s of r.sources) if (!cols.has(s)) throw new Error(`source concept "${s}" is not in the table`);
}

// Process 2: tool_2 execute (synthesize) + tool_1 execute (run programs).
app.post(
  '/api/reshape',
  wrap((req) => {
    const { table, spec, relation } = req.body as { table: Table; spec: ChartSpec; relation: ExampleRelation };
    return { candidates: reshape(table, spec, relation) };
  }),
);

// Process 3/4: tool_1 compose.
app.post(
  '/api/derive/prompts',
  wrap((req) => {
    const { request, rows, types } = req.body as { request: DerivationRequest; rows: Row[]; types: Record<string, ConceptType> };
    validateRequest(request, rows);
    return { prompts: composePrompts(request, rows, types) };
  }),
);

// Process 3/4: model generate~ + tool_1 evaluate.
app.post(
  '/api/derive/generate',
  wrap(async (req) => {
    const { request, rows, prompts } = req.body as { request: DerivationRequest; rows: Row[]; prompts: string[] };
    validateRequest(request, rows);
    const codes = await generateCandidates(prompts);
    return { candidates: evaluateCandidates(codes, rows, request.sources, request.name) };
  }),
);

// Process 3/4: tool_1 execute (apply the selected code to the whole table).
app.post(
  '/api/apply',
  wrap((req) => {
    const { code, rows, sources } = req.body as { code: string; rows: Row[]; sources: string[] };
    return { values: applyCode(code, rows, sources) };
  }),
);

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`System X backend on http://localhost:${port}`));
