import express from "express";
import path from "node:path";
import fs from "node:fs";
import type { ModelChoice, OptimizeResponse, WebCode } from "../shared/types.ts";
import { extractDiff } from "../shared/diff.ts";
import { generateCode, optimizeCode, validateWebCode } from "./models.ts";
import { measure } from "./tools/energy.ts";
import { computeSavings } from "./tools/feedback.ts";
import { loadWeights, runPipeline } from "./train/pipeline.ts";

const app = express();
app.use(express.json({ limit: "20mb" }));

// ---------------- Process 1: offline training status / trigger ----------------
let training: { running: boolean; message: string; done: number; total: number; error?: string } = {
  running: false,
  message: "",
  done: 0,
  total: 0,
};

app.get("/api/optimizer", (_req, res) => {
  const w = loadWeights();
  res.json({ weights: w && { ...w, exemplars: w.exemplars.map((e) => ({ patterns: e.patterns, savingsPercent: e.savingsPercent })) }, training });
});

app.post("/api/train", (req, res) => {
  if (training.running) return res.status(409).json({ error: "training already running" });
  const pages = Math.max(1, Math.min(2000, Number(req.body?.pages ?? 500)));
  training = { running: true, message: "starting", done: 0, total: pages };
  runPipeline({ pages, onProgress: (message, done, total) => (training = { running: true, message, done, total }) })
    .then((r) => (training = { running: false, message: `done: ${r.selected}/${r.candidates} pairs kept`, done: pages, total: pages }))
    .catch((e) => (training = { ...training, running: false, error: String(e?.message ?? e) }));
  res.json({ started: true, pages });
});

// ---------------- Process 2: model_1 generate ----------------
app.post("/api/generate", async (req, res) => {
  try {
    const { request, modelChoice } = req.body as { request: string; modelChoice: ModelChoice };
    res.json({ code: await generateCode(request, modelChoice) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// ---------------- Process 3: optimize (streams NDJSON stage events) ----------------
app.post("/api/optimize", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (o: unknown) => res.write(JSON.stringify(o) + "\n");
  try {
    const code1: WebCode = validateWebCode(req.body?.code);
    const weights = loadWeights();
    if (!weights) send({ stage: "warning", message: "No optimizer_weights found — run the training pipeline (npm run train). Using untrained optimizer." });

    send({ stage: "baseline", message: "Rendering and profiling original code (tool_1, tool_2)…" });
    const before = await measure(code1); // baseline_rendering_1, energy_before_1
    send({ stage: "baseline-done", energyBefore: before.energy });

    send({ stage: "optimize", message: "Energy-aware optimizer model is rewriting the code (model_2)…" });
    const { code: code2, changes } = await optimizeCode(code1, weights, before.energy.joules);

    send({ stage: "after", message: "Rendering and profiling optimized code (tool_1, tool_2)…" });
    const after = await measure(code2); // optimized_rendering_1, energy_after_1

    const result: OptimizeResponse = {
      code1,
      code2,
      energyBefore: before.energy,
      energyAfter: after.energy,
      baselineRendering: before.rendering,
      optimizedRendering: after.rendering,
      savings: computeSavings(before.energy, after.energy), // tool_5 evaluate
      diff: extractDiff(code1, code2), // tool_5 extract
      explanation: changes,
    };
    send({ stage: "result", result });
  } catch (e) {
    send({ stage: "error", error: String((e as Error).message ?? e) });
  }
  res.end();
});

// ---------------- static frontend in production ----------------
const dist = path.resolve(process.cwd(), "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
