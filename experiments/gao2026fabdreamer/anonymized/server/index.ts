import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runOp, OPS } from "./ops";

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, ops: Object.keys(OPS) }));

app.post("/api/model/:op", async (req, res) => {
  const started = Date.now();
  try {
    const out = await runOp(req.params.op, req.body ?? {});
    console.log(`[model] ${req.params.op} ok in ${Date.now() - started} ms`);
    res.json(out);
  } catch (e) {
    console.error(`[model] ${req.params.op} failed:`, e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const dist = join(process.cwd(), "dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`System X API on http://localhost:${port}`));
