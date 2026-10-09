import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embed, embedderName, embedderReady } from './embed.ts';
import { matchFacts } from './match.ts';
import { modelName } from './model.ts';
import { extractConcepts, extractDomain, generateAnswer, generateExplanation } from './pipeline.ts';
import { composeKnowledgeGraph, selectHighlightSpans, uid, validateCitations } from '../shared/tools.ts';
import type { AnalyzeResponse, AskResponse, Fact, HighlightSpan, KnowledgeGraph, SemanticFrame, SourceDocument } from '../shared/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const kgFile = path.join(dataDir, 'kg.json');
const sourcesFile = path.join(dataDir, 'sources.json');
fs.mkdirSync(dataDir, { recursive: true });

const readJson = <T>(f: string, fallback: T): T => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
const emptyKg = (): KnowledgeGraph => ({ nodes: [], links: [], documents: [], builtAt: '' });

let kg: KnowledgeGraph = readJson(kgFile, emptyKg());
let sources: SourceDocument[] = readJson(sourcesFile, []);

const app = express();
app.use(express.json({ limit: '20mb' }));

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e: Error) => {
      console.error(e);
      res.status(500).json({ error: e.message });
    });

app.get('/api/status', (_req, res) => res.json({ model: modelName(), embedder: embedderName }));
app.get('/api/kg', (_req, res) => res.json(kg));
app.get('/api/sources', (_req, res) => res.json(sources));

// Process 1: source_documents* → [model_1 extract] → entities* + relations* → [tool_1 compose] → knowledge_graph
app.post('/api/kg/build', wrap(async (req, res) => {
  const docs: SourceDocument[] = (req.body.documents ?? [])
    .filter((d: SourceDocument) => d.text?.trim())
    .map((d: SourceDocument) => ({ id: d.id || uid('doc'), title: d.title?.trim() || 'Untitled', text: d.text }));
  if (!docs.length) return res.status(400).json({ error: 'Add at least one source document.' });
  const extractions = await Promise.all(docs.map(extractDomain));
  kg = composeKnowledgeGraph(docs, extractions);
  sources = docs;
  fs.writeFileSync(kgFile, JSON.stringify(kg, null, 2));
  fs.writeFileSync(sourcesFile, JSON.stringify(sources, null, 2));
  res.json(kg);
}));

// Process 3: draft + semantic_frame + knowledge_graph → [model_1 extract] → [model_2 translate] → [tool_1 match] → [tool_3 select]
app.post('/api/analyze', wrap(async (req, res) => {
  const draft: string = req.body.draft ?? '';
  const frame: SemanticFrame = req.body.frame;
  if (!draft.trim() || !kg.nodes.length) return res.json({ concepts: [], facts: [], spans: [] } satisfies AnalyzeResponse);
  const concepts = await extractConcepts('draft', draft, frame, kg);
  const vectors = await embed(concepts.map((c) => c.concept));
  const facts = await matchFacts(concepts, vectors, kg);
  const spans = selectHighlightSpans(draft, facts);
  res.json({ concepts, facts, spans } satisfies AnalyzeResponse);
}));

// Process 4: clicked_span + candidate_facts* → [model_1 generate]~ → card_explanation
app.post('/api/explain', wrap(async (req, res) => {
  const span: HighlightSpan = req.body.span;
  const facts: Fact[] = req.body.facts ?? [];
  res.json({ explanation: await generateExplanation(span, facts) });
}));

// Process 5: query + semantic_frame + knowledge_graph → extract → translate → match → generate~
app.post('/api/ask', wrap(async (req, res) => {
  const query: string = (req.body.query ?? '').trim();
  const frame: SemanticFrame = req.body.frame;
  if (!query) return res.status(400).json({ error: 'Empty question.' });
  if (!kg.nodes.length) return res.status(400).json({ error: 'Build the knowledge graph from source documents first.' });
  const concepts = await extractConcepts('query', query, frame, kg);
  const vectors = await embed(concepts.map((c) => c.concept));
  const facts = await matchFacts(concepts, vectors, kg, 3);
  const answer = validateCitations(await generateAnswer(query, facts), facts);
  res.json({ concepts, facts, answer } satisfies AskResponse);
}));

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`System X server on http://localhost:${port}`);
  void embedderReady().then(() => console.log(`[model_2] embedder: ${embedderName}`));
});

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGUSR1', 'SIGUSR2'] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, shutting down`);
    process.exit(0);
  });
}
process.on('exit', (code) => console.log(`server exit ${code}`));
