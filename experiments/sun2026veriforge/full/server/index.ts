import express from "express";
import path from "node:path";
import fs from "node:fs";
import { GraphDB } from "./graphdb.ts";
import { jobs, startIngest } from "./ingest.ts";
import { composeSemanticFrame } from "./context.ts";
import { highlightGaps } from "./highlight.ts";
import { inspectHighlight } from "./card.ts";
import { queryKnowledge } from "./query.ts";
import type { Canvas, Fact, HighlightSpan, SemanticFrame } from "../shared/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const db = new GraphDB(path.join(ROOT, "data", "graph.json")); // tool_1
let semanticFrame: SemanticFrame | null = null; // semantic_frame (latest version)

const app = express();
app.use(express.json({ limit: "50mb" }));

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  });

// Process 1
app.get("/api/graph", (_req, res) => { res.json(db.stats()); });
app.post("/api/ingest", (req, res) => {
  const files = (req.body.files ?? []) as { title: string; text: string }[];
  const valid = files.filter((f) => typeof f.text === "string" && f.text.trim());
  if (!valid.length) return res.status(400).json({ error: "No text documents provided" });
  res.json(startIngest(db, valid));
});
app.get("/api/ingest/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  return job ? res.json(job) : res.status(404).json({ error: "unknown job" });
});
app.delete("/api/graph", (_req, res) => { db.clear(); res.json(db.stats()); });
app.get("/api/passage/:id", (req, res) => {
  const p = db.passage(req.params.id);
  return p ? res.json(p) : res.status(404).json({ error: "unknown passage" });
});

// Process 2 / 9: tool_2 compose (called asynchronously by the client)
app.post("/api/frame", (req, res) => {
  const { draft, canvas } = req.body as { draft: string; canvas: Canvas };
  semanticFrame = composeSemanticFrame(draft ?? "", canvas ?? { nodes: [], edges: [] });
  res.json(semanticFrame);
});

// Process 3
app.post("/api/highlight", wrap(async (req, res) => {
  const { draft } = req.body as { draft: string };
  res.json({ ...(await highlightGaps(db, draft ?? "", semanticFrame)), frameVersion: semanticFrame?.version ?? 0 });
}));

// Process 4
app.post("/api/card", wrap(async (req, res) => {
  const { draft, span, facts } = req.body as { draft: string; span: HighlightSpan; facts: Fact[] };
  res.json(await inspectHighlight(draft, span, facts));
}));

// Process 5
app.post("/api/query", wrap(async (req, res) => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) return res.status(400).json({ error: "empty query" });
  res.json(await queryKnowledge(db, query.trim(), semanticFrame));
}));

// Process 6: tool_1 match over canvas nodes
app.post("/api/canvas/relate", wrap(async (req, res) => {
  const { nodes } = req.body as { nodes: { id: string; concept: string; entityKeys: string[] }[] };
  res.json(await db.relateNodes(nodes ?? []));
}));

const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`System X API on http://localhost:${PORT}`));
