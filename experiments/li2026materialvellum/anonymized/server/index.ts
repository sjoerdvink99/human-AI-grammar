import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { model1GenerateFromRender, model1GenerateFromSketch, model1GenerateItem, model1Modify, model2Describe } from "./models.ts";
import { CATEGORIES, type ItemRecord } from "../src/shared/types.ts";

const app = express();
app.use(express.json({ limit: "5mb" }));

type Handler = (body: any) => Promise<unknown>;
const route = (path: string, h: Handler) =>
  app.post(path, async (req, res) => {
    const t0 = Date.now();
    try {
      const out = await h(req.body ?? {});
      console.log(`${path} ok ${Date.now() - t0}ms`);
      res.json(out);
    } catch (e) {
      console.error(`${path} failed`, e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
  return v;
};
const record = (r: any): ItemRecord => {
  if (!r || !CATEGORIES.includes(r.label)) throw new Error("record.label must be one of the fixed categories");
  for (const k of ["x", "y", "w", "h"]) if (typeof r.region?.[k] !== "number" || r.region[k] < 0) throw new Error("record.region invalid");
  if (r.region.w < 8 || r.region.h < 8) throw new Error("record.region too small");
  return r as ItemRecord;
};

route("/api/model1/generate-from-render", async (b) => ({ svg: await model1GenerateFromRender(str(b.render, "render")) }));
route("/api/model1/modify", async (b) => {
  if (!Array.isArray(b.selections) || b.selections.length === 0) throw new Error("at least one selection is required");
  if (!Array.isArray(b.instructions) || b.instructions.length !== b.selections.length) throw new Error("one instruction per selection");
  return model1Modify(str(b.image, "image"), b.selections, b.instructions);
});
route("/api/model1/generate-from-sketch", async (b) => ({ svg: await model1GenerateFromSketch(str(b.sketch, "sketch"), str(b.description, "description")) }));
route("/api/model2/describe", async (b) => ({ text: await model2Describe(typeof b.globalPrompt === "string" ? b.globalPrompt : "", record(b.record)) }));
route("/api/model1/generate-item", async (b) => ({ svg: await model1GenerateItem(record(b.record), str(b.description, "description")) }));

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8791);
app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
