import express from "express";
import path from "node:path";
import { ask, buildGraph, groundDraft, suggest } from "./pipelines";

const app = express();
app.use(express.json({ limit: "20mb" }));

const route =
  (fn: (body: any) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await fn(req.body));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  };

// P1
app.post("/api/graph", route((b) => buildGraph(b.sourceDocuments)));
// P3
app.post("/api/ground", route((b) => groundDraft(b.draft, b.draftContext, b.knowledgeGraph)));
// P4
app.post("/api/suggest", route((b) => suggest(b.selectedSpan, b.groundings, b.knowledgeGraph)));
// P5
app.post("/api/ask", route((b) => ask(b.question, b.draftContext, b.knowledgeGraph, b.sourceDocuments)));

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
