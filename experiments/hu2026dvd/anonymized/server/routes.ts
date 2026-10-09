import { Router } from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callModel } from "./model";
import { CANVAS, dedupeIds, sanitizeSvg, validateElement } from "../shared/sanitize";
import { pointInPolygon } from "../shared/pictorial";
import { ELEMENT_KINDS, type IllustrationRequest, type TextItem } from "../shared/types";

export const api = Router();

// ---------------------------------------------------------------------------
// Process 1 — [model_1 generate]~ : brief r1 + style refs r2* + documents r3* → elements r4*
// ---------------------------------------------------------------------------
const MODEL_1_SYSTEM = `You are an infographic designer. You turn a brief, style references and source documents
into a set of visual elements laid out on a ${CANVAS.width}x${CANVAS.height} pixel canvas (origin top-left).
Rules:
- Produce 5 to 12 elements: exactly one "headline", plus a mix of "illustration", "icon", "text", "annotation", "shape".
- Every factual claim (headline, text, annotation) must cite at least one source document with an exact, verbatim quote (copy characters exactly).
- Illustrations, icons and shapes carry inner SVG markup for a 0 0 100 100 viewBox using only path, rect, circle, ellipse, line, polyline, polygon, g. No text, no images, no scripts.
- Elements must stay inside the canvas and should not overlap heavily. Leave the headline at the top.
- Follow the style references for palette, tone and composition.
- Colors are hex codes.`;

const ELEMENTS_SCHEMA = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: [...ELEMENT_KINDS] },
          description: { type: "string" },
          text: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          color: { type: "string" },
          svg: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { docId: { type: "string" }, quote: { type: "string" } },
              required: ["docId", "quote"],
            },
          },
        },
        required: ["id", "name", "kind", "description", "text", "x", "y", "w", "h", "color", "svg", "sources"],
      },
    },
  },
  required: ["elements"],
};

api.post("/elements", async (req, res) => {
  try {
    const brief: string = String(req.body?.brief ?? "").trim();
    const styleRefs: TextItem[] = req.body?.styleRefs ?? [];
    const documents: TextItem[] = req.body?.documents ?? [];
    if (!brief) return res.status(400).json({ error: "The brief (r1) is empty." });
    if (!documents.length) return res.status(400).json({ error: "Add at least one source document (r3)." });
    const prompt = [
      `BRIEF:\n${brief}`,
      `STYLE REFERENCES:\n${styleRefs.map((s) => `- ${s.title}: ${s.text}`).join("\n") || "(none)"}`,
      `SOURCE DOCUMENTS:\n${documents.map((d) => `<document id="${d.id}" title="${d.title}">\n${d.text}\n</document>`).join("\n")}`,
      `Return the elements as JSON.`,
    ].join("\n\n");
    const out = await callModel<{ elements: unknown[] }>({ system: MODEL_1_SYSTEM, prompt, schema: ELEMENTS_SCHEMA });
    const docIds = new Set(documents.map((d) => d.id));
    const elements = dedupeIds((out.elements ?? []).map((e, i) => validateElement(e, i, docIds)));
    if (!elements.length) return res.status(502).json({ error: "The model returned no elements." });
    res.json({ elements });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Process 4 — [model_2 generate]~ : illustration request r14 → illustration r15
// ---------------------------------------------------------------------------
const MODEL_2_SYSTEM = `You are an illustrator who draws in SVG. Given an illustration request, produce one detailed,
polished vector illustration. Use only path, rect, circle, ellipse, line, polyline, polygon, g, defs, linearGradient,
radialGradient, stop. No text elements, no images, no scripts, no external references. Respect the palette and aspect.`;

const ILLUSTRATION_SCHEMA = {
  type: "object",
  properties: { viewBox: { type: "string" }, svg: { type: "string" }, alt: { type: "string" } },
  required: ["viewBox", "svg", "alt"],
};

const ASPECT_VIEWBOX = { square: "0 0 400 400", landscape: "0 0 600 400", portrait: "0 0 400 600" };

api.post("/illustrate", async (req, res) => {
  try {
    const r: IllustrationRequest = req.body?.request;
    if (!r?.subject) return res.status(400).json({ error: "Missing illustration request (r14)." });
    const viewBox = ASPECT_VIEWBOX[r.aspect] ?? ASPECT_VIEWBOX.square;
    const prompt = `ILLUSTRATION REQUEST (JSON):\n${JSON.stringify(r, null, 2)}\n\nUse viewBox "${viewBox}". Return the inner SVG markup (without the outer <svg> tag).`;
    const out = await callModel<{ viewBox: string; svg: string; alt: string }>({
      system: MODEL_2_SYSTEM,
      prompt,
      schema: ILLUSTRATION_SCHEMA,
    });
    const inner = sanitizeSvg(out.svg);
    if (!/<(path|rect|circle|ellipse|polygon|polyline|line)\b/.test(inner))
      return res.status(502).json({ error: "The illustration contained no drawable shapes." });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
    res.json({ svg, alt: String(out.alt ?? "").slice(0, 300) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Processes 6 & 7 — [model_3 extract] : region crop r19 + click points r20 (+ scene r6, chart r18) → object mask r21
// ---------------------------------------------------------------------------
const MODEL_3_SYSTEM = `You are a precise image segmentation model. You look at an image and output the outline
of one object as a polygon in normalized coordinates (0..1, origin top-left, x to the right, y down).
The object is the one under the positive points; it must exclude the negative points.
Trace the object's silhouette closely with 12 to 60 vertices in order around the outline.`;

const MASK_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    polygon: {
      type: "array",
      items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
    },
  },
  required: ["label", "polygon"],
};

function dataUrlToBuffer(u: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/.exec(u ?? "");
  if (!m) throw new Error("Expected a PNG data URL");
  return Buffer.from(m[1], "base64");
}

api.post("/extract", async (req, res) => {
  let dir = "";
  try {
    const { crop, annotated, width, height, points } = req.body ?? {};
    const pts: { x: number; y: number; positive: boolean }[] = Array.isArray(points) ? points : [];
    if (!pts.some((p) => p.positive)) return res.status(400).json({ error: "Click at least one point on the object (r20)." });
    dir = await mkdtemp(join(tmpdir(), "systemx-"));
    const cropPath = join(dir, "crop.png");
    const annPath = join(dir, "crop-annotated.png");
    await writeFile(cropPath, dataUrlToBuffer(crop));
    await writeFile(annPath, dataUrlToBuffer(annotated ?? crop));
    const ptsText = pts
      .map((p) => `(${(p.x / width).toFixed(3)}, ${(p.y / height).toFixed(3)}) ${p.positive ? "POSITIVE (on object)" : "NEGATIVE (not object)"}`)
      .join("\n");
    const basePrompt = `Read these two image files with the Read tool:
1. ${cropPath} — the image region (${width}x${height} px).
2. ${annPath} — the same region with a 10% grid and the points drawn (green = positive, red = negative).
Points (normalized x, y):
${ptsText}
Return the polygon outline of the object, normalized to the image size.`;

    let feedback = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await callModel<{ label: string; polygon: { x: number; y: number }[] }>({
        system: MODEL_3_SYSTEM,
        prompt: basePrompt + feedback,
        schema: MASK_SCHEMA,
        imagePaths: [cropPath, annPath],
      });
      const poly = (out.polygon ?? [])
        .map((p) => ({ x: Math.min(1, Math.max(0, Number(p.x))), y: Math.min(1, Math.max(0, Number(p.y))) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ x: p.x * width, y: p.y * height }));
      const missed = pts.filter((p) => pointInPolygon(p, poly) !== p.positive);
      if (poly.length >= 3 && missed.length === 0) return res.json({ polygon: poly, label: out.label, attempts: attempt + 1 });
      feedback = `\n\nYour previous polygon was invalid: ${poly.length < 3 ? "fewer than 3 vertices" : `${missed.length} point(s) were on the wrong side`}. Fix it.`;
      if (attempt === 1)
        return res.json({
          polygon: poly.length >= 3 ? poly : null,
          label: out.label,
          attempts: 2,
          warning: poly.length >= 3 ? "The outline does not respect every click point; review it before cutting out." : undefined,
          error: poly.length < 3 ? "The model could not produce an outline." : undefined,
        });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    if (dir) rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
