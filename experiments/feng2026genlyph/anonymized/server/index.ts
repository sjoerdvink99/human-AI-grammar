import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, extractJson } from "./model.ts";
import { themesPrompt, illustratePrompt, segmentPrompt, describePrompt, variantPrompt, type SegElement } from "./prompts.ts";
import { extractSvg } from "../src/tools/sanitize.ts";

const app = express();
app.use(express.json({ limit: "10mb" }));

type Handler = (body: any) => Promise<unknown>;
function route(name: string, fn: Handler) {
  app.post(`/api/model/${name}`, async (req, res) => {
    try {
      res.json(await fn(req.body));
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });
}

/** Retry a generative call once if its output fails validation. */
async function withValidation<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    console.warn("validation failed, retrying once:", (e as Error).message);
    return attempt();
  }
}

// model_1 generate~ : r3 -> r4
route("themes", async ({ r3 }) => {
  if (typeof r3 !== "string" || !r3.trim()) throw new Error("r3 (data description) is required");
  const p = themesPrompt(r3);
  const r4 = await callModel({ role: "model_1", kind: "text", ...p });
  return { r4 };
});

// model_2 generate~ : r7 / r10 -> r8 item
route("illustrate", async ({ prompt }) => {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt is required");
  const p = illustratePrompt(prompt);
  const svg = await withValidation(async () => extractSvg(await callModel({ role: "model_2", kind: "svg", ...p })));
  return { svg };
});

// model_3 extract : r11 + r12 -> r13_1
route("segment", async ({ elements, selections }) => {
  if (!Array.isArray(selections) || selections.length === 0) throw new Error("draw at least one selection (r12)");
  if (!Array.isArray(elements) || elements.length === 0) throw new Error("no shapes inside the selections");
  const known = new Set((elements as SegElement[]).map((e) => e.id));
  const p = segmentPrompt(elements.slice(0, 400), selections);
  const out = await withValidation(async () => {
    const parsed = extractJson<{ segments: { name: string; selection?: number; elementIds: string[] }[] }>(
      await callModel({ role: "model_3", kind: "json", ...p }),
    );
    if (!Array.isArray(parsed.segments)) throw new Error("segments missing");
    return parsed;
  });
  const used = new Set<string>();
  const segments = out.segments
    .map((s) => ({
      name: String(s.name ?? "segment").slice(0, 40),
      selection: typeof s.selection === "number" ? s.selection - 1 : undefined,
      elementIds: (s.elementIds ?? []).filter((id) => known.has(id) && !used.has(id) && used.add(id)),
    }))
    .filter((s) => s.elementIds.length > 0);
  return { segments };
});

// model_4 generate~ : r15 item (+ r14 label) -> r17 item
route("describe", async ({ r15, label }) => {
  if (typeof r15 !== "string") throw new Error("r15 (crop) is required");
  const p = describePrompt(r15.slice(0, 40_000), label ?? { name: "element" });
  const r17 = (await callModel({ role: "model_4", kind: "text", ...p })).trim();
  return { r17 };
});

// model_5 generate~ : r18 item (+ r16 aspect) -> r19 item
route("variant", async ({ r18, r16 }) => {
  if (typeof r18 !== "string" || !r18.trim()) throw new Error("r18 (variant prompt) is required");
  const p = variantPrompt(r18, r16 ?? { w: 1, h: 1 });
  const svg = await withValidation(async () => extractSvg(await callModel({ role: "model_5", kind: "svg", ...p })));
  return { svg };
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`server on http://localhost:${port}`));
