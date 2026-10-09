import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CodeCandidate, Table } from '../src/types';
import { callModel, extractCode } from './model';
import { applyDerivation, evaluateCandidates } from './sandbox';

const app = express();
app.use(express.json({ limit: '20mb' }));

const SYSTEM = 'You are a careful JavaScript programmer who completes data-transformation functions. Output only code.';

/** [model generate]~: r12* -> r13*. One model call per prompt, run in parallel. */
app.post('/api/generate', async (req, res) => {
  const prompts = req.body.prompts as string[];
  if (!Array.isArray(prompts) || prompts.length === 0) return res.status(400).json({ error: 'prompts required' });
  const results = await Promise.allSettled(prompts.map((p) => callModel(p, { system: SYSTEM })));
  const candidates: CodeCandidate[] = [];
  const failures: { promptIndex: number; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') return failures.push({ promptIndex: i, error: String(r.reason?.message ?? r.reason) });
    const code = extractCode(r.value);
    if (!code) return failures.push({ promptIndex: i, error: 'response contained no derive() function' });
    candidates.push({ id: `c${i + 1}`, code, promptIndex: i });
  });
  res.json({ candidates, failures });
});

/** [tool_1 evaluate]: r13* -> r14* + r15*. */
app.post('/api/evaluate', (req, res) => {
  const { candidates, table, name, sourceFields } = req.body as { candidates: CodeCandidate[]; table: Table; name: string; sourceFields: string[] };
  res.json(evaluateCandidates(candidates, table, name, sourceFields ?? []));
});

/** [tool_1 execute]: r1 + r16 -> r1'. */
app.post('/api/execute', (req, res) => {
  const { code, table, name } = req.body as { code: string; table: Table; name: string };
  try {
    res.json({ table: applyDerivation(code, table, name) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
