// One prompt per model operation in the design. Each op builds its prompt only from the
// representations in the state that precedes it, asks for schema-constrained JSON, and
// validates the result before it reaches the UI.

import { z } from "zod";
import { callModel, type ModelRole } from "./provider";
import { sanitizeSvg, CANVAS } from "../src/shared/tools1";
import type { Assembly, PlannedPart } from "../src/shared/types";

// ---------- JSON-schema helpers ----------
const S = {
  str: { type: "string" },
  num: { type: "number" },
  bool: { type: "boolean" },
  enum: (...v: string[]) => ({ type: "string", enum: v }),
  arr: (items: object, extra: object = {}) => ({ type: "array", items, ...extra }),
  obj: (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false }),
};
const dimSchema = S.obj({ w: S.num, h: S.num, d: S.num });
const vecSchema = S.obj({ x: S.num, y: S.num, z: S.num });

const dimZ = z.object({ w: z.number().positive(), h: z.number().positive(), d: z.number().positive() });
const vecZ = z.object({ x: z.number(), y: z.number(), z: z.number() });
const svgZ = z.string().transform((s, ctx) => {
  try {
    const clean = sanitizeSvg(s);
    if (clean.length > 120_000) throw new Error("SVG too large");
    return clean;
  } catch (e) { ctx.addIssue({ code: "custom", message: String(e) }); return z.NEVER; }
});

// ---------- system prompts per model role ----------
const SYS: Record<ModelRole, string> = {
  model_1: "You are model_1, a design analyst for physical objects (furniture, products, toys). You read SVG images as source code and reason about what they depict. Units are millimetres. Answer only with the requested JSON.",
  model_2: `You are model_2, an image generator and editor that draws with SVG. Always return one complete standalone SVG document: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">. Flat vector illustration with clear dark outlines (#222, stroke-width 2–3) and flat fills. No text, no <script>, no external references, no raster images, NO background rectangle (leave the background transparent). Keep it under 10 000 characters. Draw every distinct physical piece as its own <g> with an id. Answer only with the requested JSON.`,
  model_3: `You are model_3, a visual grounding model. Given an SVG image (${CANVAS}×${CANVAS} viewBox, y grows downward) and text queries, you return tight axis-aligned bounding boxes in viewBox coordinates by reading the shapes' coordinates and transforms in the SVG source. Answer only with the requested JSON.`,
  model_4: "You are model_4, a fabrication advisor for small-scale making (laser cutting, CNC, 3D printing, woodworking). You explain check results plainly and propose concrete geometric fixes. Coordinates are millimetres, y is up, the ground is y = 0, positions are part centres. Answer only with the requested JSON.",
};

interface OpDef {
  role: ModelRole;
  schema: Record<string, unknown>;
  prompt: (input: any) => string;
  validate: (raw: unknown, input: any) => unknown;
}

const svgOut = S.obj({ svg: S.str });
const validateSvg = (raw: unknown) => z.object({ svg: svgZ }).parse(raw);

const VARIATIONS = [
  "a faithful, straightforward interpretation",
  "a more minimal, geometric interpretation",
  "a more expressive interpretation with distinctive details",
  "a sturdy, practical interpretation",
];

export const OPS: Record<string, OpDef> = {
  // P1 / P6 — model_2 generate~ : instruction language → visual*
  generateImage: {
    role: "model_2", schema: svgOut, validate: validateSvg,
    prompt: ({ prompt, variant, kind }) =>
      `${kind === "part" ? "Draw a single object part, isolated, seen straight from the front (orthographic)." : "Draw a concept image of the object, seen straight from the front (orthographic elevation), centred and filling about 80% of the canvas."}\n` +
      `Request: """${prompt}"""\nStyle direction: ${VARIATIONS[variant % VARIATIONS.length]}.\nReturn {"svg": "<svg …>…</svg>"}.`,
  },

  // P2, P4 loop — model_2 modify~ : visual + instruction language → visual
  editImage: {
    role: "model_2", schema: svgOut, validate: validateSvg,
    prompt: ({ svg, instruction }) =>
      `Edit this SVG image according to the instruction. Keep everything the instruction does not mention unchanged (same view, layout, colours).\nInstruction: """${instruction}"""\nImage:\n${svg}\nReturn {"svg": …} with the full edited SVG.`,
  },

  // P3 — model_1 generate~ : visual → record (r5)
  generateSpec: {
    role: "model_1",
    schema: S.obj({
      name: S.str, summary: S.str, category: S.str, dimensions: dimSchema, materials: S.arr(S.str), style: S.str,
      parts: S.arr(S.obj({ name: S.str, description: S.str, material: S.str, count: { type: "integer" } }), { minItems: 1 }),
    }),
    validate: (raw) => specZ.parse(raw),
    prompt: ({ svg }) =>
      `Look at this concept image of a physical object (SVG source below) and write a design specification for making it.\n` +
      `Give realistic overall dimensions in mm (w = width left-right, h = height, d = depth front-back), the materials, the style, and the list of distinct part types with how many of each (e.g. "leg", count 4).\nImage:\n${svg}`,
  },

  // P3 loop — model_1 modify~ : visual + record + instruction → record (r5)
  reviseSpec: {
    role: "model_1",
    schema: S.obj({
      name: S.str, summary: S.str, category: S.str, dimensions: dimSchema, materials: S.arr(S.str), style: S.str,
      parts: S.arr(S.obj({ name: S.str, description: S.str, material: S.str, count: { type: "integer" } }), { minItems: 1 }),
    }),
    validate: (raw) => specZ.parse(raw),
    prompt: ({ svg, spec, feedback }) =>
      `Revise the design specification according to the designer's feedback. Change only what the feedback asks for; keep it consistent with the concept image.\n` +
      `Feedback: """${feedback}"""\nCurrent specification:\n${JSON.stringify(spec, null, 2)}\nConcept image:\n${svg}`,
  },

  // P4 — model_1 extract : visual + instruction record (r7) → record* (r8)
  extractParts: {
    role: "model_1",
    schema: S.obj({
      parts: S.arr(S.obj({
        name: S.str, shape: S.enum("box", "cylinder"), material: S.str, size: dimSchema,
        zHint: S.enum("front", "center", "back"), attachTo: { type: ["string", "null"] }, notes: S.str,
      }), { minItems: 1, maxItems: 16 }),
    }),
    validate: (raw) => {
      const v = z.object({ parts: z.array(z.object({
        name: z.string().min(1), shape: z.enum(["box", "cylinder"]), material: z.string(), size: dimZ,
        zHint: z.enum(["front", "center", "back"]), attachTo: z.string().nullable(), notes: z.string(),
      })).min(1).max(16) }).parse(raw);
      // give each physical piece a stable, unique id
      const used = new Set<string>();
      return { parts: v.parts.map((p) => {
        let id = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "part";
        let k = 2; const base = id;
        while (used.has(id)) id = `${base}_${k++}`;
        used.add(id);
        return { id, ...p };
      }) };
    },
    prompt: ({ svg, selection }) =>
      `Decompose the object into individual physical pieces to fabricate, using only the selected part types and the target overall size.\n` +
      `List every physical piece separately (4 legs → 4 entries named e.g. "front left leg"), at most 16. For each: primitive shape (box or cylinder; for cylinders w = d = diameter, h = length along y), material, approximate size in mm, ` +
      `whether it sits at the front, centre or back in depth (zHint), the name of the piece it attaches to (or null), and short notes.\n` +
      `Selection: ${JSON.stringify(selection)}\nConcept image:\n${svg}`,
  },

  // P4 — model_1 extract : visual + record* → language (r9)
  extractAssemblyNotes: {
    role: "model_1", schema: S.obj({ notes: S.str }),
    validate: (raw) => z.object({ notes: z.string().min(1) }).parse(raw),
    prompt: ({ svg, parts }) =>
      `Write concise assembly notes (5–10 sentences or bullet lines as plain text) explaining how these pieces connect and in which order to assemble them, as seen in the image.\nPieces:\n${JSON.stringify(parts, null, 2)}\nImage:\n${svg}`,
  },

  // P4 — model_1 extract : r10 + r8* + r9 + r11* → instruction record* (r12)
  groundingQueries: {
    role: "model_1",
    schema: S.obj({ queries: S.arr(S.obj({ partId: S.str, query: S.str })) }),
    validate: (raw, input) => {
      const v = z.object({ queries: z.array(z.object({ partId: z.string(), query: z.string().min(1) })) }).parse(raw);
      const ids = new Set((input.parts as { id: string }[]).map((p) => p.id));
      return { queries: v.queries.filter((q) => ids.has(q.partId)) };
    },
    prompt: ({ svg, parts, notes }) =>
      `For each piece, write one short visual grounding query that a grounding model can use to find exactly that piece in the image ` +
      `(mention position cues such as "leftmost vertical leg", "top horizontal slab"). Pieces hidden in a front view (e.g. back legs behind front legs) should be described as the visible piece they coincide with. Use the given partId values.\n` +
      `Pieces:\n${JSON.stringify(parts.map((p: any) => ({ partId: p.id, name: p.name, shape: p.shape, zHint: p.zHint, notes: p.notes })), null, 2)}\nAssembly notes: ${notes}\nImage:\n${svg}`,
  },

  // P4 — model_3 extract : r10 + r12* → selection spatial* (r13)
  ground: {
    role: "model_3",
    schema: S.obj({ boxes: S.arr(S.obj({ partId: S.str, x: S.num, y: S.num, w: S.num, h: S.num, confidence: S.num })) }),
    validate: (raw, input) => validateBoxes(raw, input.queries),
    prompt: ({ svg, queries }) =>
      `Return one bounding box per query (x, y = top-left corner, w, h in viewBox units of the ${CANVAS}×${CANVAS} canvas, after applying all transforms) and a confidence 0–1.\n` +
      `Queries:\n${JSON.stringify(queries, null, 2)}\nImage:\n${svg}`,
  },

  // P4 — model_1 generate~ : r10 + r8* + r9 + r11_2* → instruction language (r14)
  critiqueParts: {
    role: "model_1", schema: S.obj({ ok: S.bool, instruction: S.str }),
    validate: (raw) => z.object({ ok: z.boolean(), instruction: z.string() }).parse(raw),
    prompt: ({ svg, parts, notes, parts3d }) =>
      `Compare the extracted 3D parts (sizes and positions in mm, with the image box each was grounded to) with the reference image and the part list.\n` +
      `If they are consistent, return ok = true and an empty instruction. Otherwise return ok = false and ONE concise instruction for an image editor ` +
      `that would make the reference image easier to decompose (e.g. "separate the seat from the backrest with a visible gap", "make the drawer front a separate shape"). The image MUST stay a straight front orthographic view; never ask for perspective or another view. Pieces hidden behind others in a front view are expected and are not a problem.\n` +
      `Part list:\n${JSON.stringify(parts)}\nAssembly notes: ${notes}\n3D parts:\n${JSON.stringify(parts3d.map((p: any) => ({ id: p.id, name: p.name, size: p.size, position: p.position, imageBox: p.imageBox })))}\nReference image:\n${svg}`,
  },

  // P5 — model_3 modify : r10 + r12* + r13* + r15* → selection spatial* (r16)
  reground: {
    role: "model_3",
    schema: S.obj({ boxes: S.arr(S.obj({ partId: S.str, x: S.num, y: S.num, w: S.num, h: S.num, confidence: S.num })) }),
    validate: (raw, input) => validateBoxes(raw, input.queries),
    prompt: ({ svg, queries, boxes, checks }) =>
      `Some of your previous bounding boxes failed automatic checks. Return a corrected box for EVERY query (keep passing boxes as they are, fix the failing ones).\n` +
      `Queries:\n${JSON.stringify(queries)}\nPrevious boxes:\n${JSON.stringify(boxes)}\nChecks:\n${JSON.stringify(checks)}\nImage:\n${svg}`,
  },

  // P5 — model_2 generate~ : r10 + r12 + r15_2 → visual* (r17), one call per part
  sideView: {
    role: "model_2", schema: svgOut, validate: validateSvg,
    prompt: ({ svg, query, check }) =>
      `Draw ONLY the piece described below, isolated, seen exactly from the RIGHT SIDE (orthographic side elevation: horizontal axis = depth, vertical axis = height), ` +
      `filling most of the canvas while keeping its true side-view proportions. Use one dark fill (#555) with no other shapes, so its silhouette can be measured.\n` +
      `Piece: """${query}"""${check && !check.pass ? `\n(Note: its front-view detection was uncertain: ${check.issues.join("; ")})` : ""}\nFront-view reference image of the whole object:\n${svg}`,
  },

  // P6 — model_1 evaluate : visual → categorical (r23)
  judgePartImage: {
    role: "model_1",
    schema: S.obj({ verdict: S.enum("usable", "needs_cleanup", "unusable"), reason: S.str }),
    validate: (raw) => z.object({ verdict: z.enum(["usable", "needs_cleanup", "unusable"]), reason: z.string() }).parse(raw),
    prompt: ({ svg }) =>
      `Judge whether this image can be turned into a 3D part by extruding its silhouette: it must show a single isolated object in a straight front view. ` +
      `Answer "usable", "needs_cleanup" (right object but extra shapes, perspective, or background), or "unusable".\nImage:\n${svg}`,
  },

  // P6 — model_2 generate~ : visual + categorical → visual (r24)
  cleanPartImage: {
    role: "model_2", schema: svgOut, validate: validateSvg,
    prompt: ({ svg, verdict }) =>
      `Redraw the object in this image as a clean silhouette for fabrication: straight front orthographic view, single object, no background, no shading, ` +
      `one dark fill (#555), filling most of the canvas. The image was judged "${verdict}".\nImage:\n${svg}`,
  },

  // P8 — model_2 modify~ : visual crop (r30) + categorical (r29) → visual (r31)
  regeneratePart: {
    role: "model_2", schema: svgOut, validate: validateSvg,
    prompt: ({ svg, partName }) =>
      `This is a crop of a concept image around the piece "${partName}". Redraw ONLY that piece, complete and isolated (fill in anything occluded), ` +
      `in a straight front orthographic view, as one dark silhouette (#555), filling most of the ${CANVAS}×${CANVAS} canvas with its true proportions. Remove all other pieces.\nCrop:\n${svg}`,
  },

  // P9 — model_1 extract : r27 + r33 + r34 → instruction record* (r35)
  planPartEdit: {
    role: "model_1",
    schema: S.obj({ planned: S.arr(S.obj({
      action: S.enum("add", "replace"), replacesId: { type: ["string", "null"] }, anchorId: { type: ["string", "null"] },
      name: S.str, shape: S.enum("box", "cylinder"), material: S.str, size: dimSchema, placement: S.str,
    }), { minItems: 1, maxItems: 8 }) }),
    validate: (raw, input) => {
      const asm = input.assembly as Assembly;
      const v = z.object({ planned: z.array(z.object({
        action: z.enum(["add", "replace"]), replacesId: z.string().nullable(), anchorId: z.string().nullable(),
        name: z.string(), shape: z.enum(["box", "cylinder"]), material: z.string(), size: dimZ, placement: z.string(),
      })).min(1).max(8) }).parse(raw);
      const byId = new Map(asm.parts.map((p) => [p.id, p]));
      const planned: PlannedPart[] = v.planned.map((p, i) => {
        const anchorPart = byId.get(p.anchorId ?? "") ?? byId.get(p.replacesId ?? "") ?? byId.get(input.partId);
        return {
          key: `k${i}`, action: p.action, replacesId: p.action === "replace" && p.replacesId && byId.has(p.replacesId) ? p.replacesId : null,
          name: p.name, shape: p.shape, material: p.material, size: p.size, placement: p.placement,
          anchor: anchorPart ? { id: anchorPart.id, name: anchorPart.name, position: anchorPart.position, size: anchorPart.size } : null,
        };
      });
      return { planned };
    },
    prompt: ({ assembly, partId, instruction }) =>
      `The designer selected the part "${partId}" in the 3D assembly and asked: """${instruction}"""\n` +
      `Plan the parts to add or replace. For each: action, replacesId (id of the part being replaced, or null), anchorId (id of the existing part the placement is relative to), ` +
      `name, primitive shape, material, size in mm, and a precise placement description relative to the anchor (e.g. "directly below the anchor, flush with its front face, 20 mm gap").\n` +
      `Assembly (mm, y up, ground y = 0, positions are centres):\n${JSON.stringify((assembly as Assembly).parts.map((p) => ({ id: p.id, name: p.name, shape: p.shape, size: p.size, position: p.position, material: p.material })))}`,
  },

  // P9 — model_3 extract : r35* → selection spatial* (r36)
  place3d: {
    role: "model_3",
    schema: S.obj({ placements: S.arr(S.obj({ key: S.str, position: vecSchema, size: dimSchema })) }),
    validate: (raw, input) => {
      const v = z.object({ placements: z.array(z.object({ key: z.string(), position: vecZ, size: dimZ })) }).parse(raw);
      const keys = new Set((input.planned as PlannedPart[]).map((p) => p.key));
      return { placements: v.placements.filter((p) => keys.has(p.key)) };
    },
    prompt: ({ planned }) =>
      `Ground each planned part in 3D: return its centre position and size (mm, y up, ground y = 0) so that it satisfies its placement description relative to its anchor's geometry. ` +
      `Parts must not go below the ground. Use the given keys.\nPlanned parts:\n${JSON.stringify(planned, null, 2)}`,
  },

  // P10 — model_4 generate~ : r27 + r38 + r39* → evaluation language (r40)
  adviseFab: {
    role: "model_4",
    schema: S.obj({ summary: S.str, suggestions: S.arr(S.obj({ id: S.str, title: S.str, rationale: S.str }), { maxItems: 5 }) }),
    validate: (raw) => z.object({ summary: z.string(), suggestions: z.array(z.object({ id: z.string(), title: z.string(), rationale: z.string() })).max(5) }).parse(raw),
    prompt: ({ assembly, constraints, checks }) =>
      `Explain the fabrication check results for this design in 2–4 plain sentences, then propose up to 5 concrete, independent fixes the designer can choose from ` +
      `(each changes geometry: move, resize, rotate, delete or add parts). If everything passes, suggest optional improvements or none.\n` +
      `Constraints:\n${JSON.stringify(constraints)}\nChecks:\n${JSON.stringify(checks)}\nAssembly:\n${JSON.stringify(assembly.parts.map((p: any) => ({ id: p.id, name: p.name, shape: p.shape, size: p.size, position: p.position, rotationY: p.rotationY, material: p.material })))}`,
  },

  // P10 — model_4 translate : r27 + r38 + r41 → instruction record (r42)
  suggestionToOps: {
    role: "model_4",
    schema: S.obj({ ops: S.arr(S.obj({
      op: S.enum("move", "resize", "rotate", "delete", "add"), partId: { type: ["string", "null"] },
      position: { anyOf: [vecSchema, { type: "null" }] }, size: { anyOf: [dimSchema, { type: "null" }] },
      rotationY: { type: ["number", "null"] }, name: { type: ["string", "null"] }, shape: { anyOf: [S.enum("box", "cylinder"), { type: "null" }] }, material: { type: ["string", "null"] },
    }, ["op", "partId", "position", "size", "rotationY", "name", "shape", "material"])) }),
    validate: (raw) => {
      const v = z.object({ ops: z.array(z.object({
        op: z.enum(["move", "resize", "rotate", "delete", "add"]), partId: z.string().nullable(), position: vecZ.nullable(), size: dimZ.nullable(),
        rotationY: z.number().nullable(), name: z.string().nullable(), shape: z.enum(["box", "cylinder"]).nullable(), material: z.string().nullable(),
      })) }).parse(raw);
      return { ops: v.ops.map((o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null))) };
    },
    prompt: ({ assembly, constraints, suggestion }) =>
      `Translate the chosen fix into exact edit operations on the assembly. Operations: move (partId, new centre position), resize (partId, full new size), ` +
      `rotate (partId, rotationY degrees about the vertical axis), delete (partId), add (name, shape, material, size, position). Set unused fields to null. Use existing part ids.\n` +
      `Chosen fix: ${JSON.stringify(suggestion)}\nConstraints:\n${JSON.stringify(constraints)}\nAssembly:\n${JSON.stringify(assembly.parts.map((p: any) => ({ id: p.id, name: p.name, shape: p.shape, size: p.size, position: p.position, rotationY: p.rotationY, material: p.material })))}`,
  },
};

const specZ = z.object({
  name: z.string().min(1), summary: z.string(), category: z.string(), dimensions: dimZ, materials: z.array(z.string()), style: z.string(),
  parts: z.array(z.object({ name: z.string().min(1), description: z.string(), material: z.string(), count: z.number().int().min(1) })).min(1),
});

function validateBoxes(raw: unknown, queries: { partId: string }[]) {
  const v = z.object({ boxes: z.array(z.object({ partId: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), confidence: z.number() })) }).parse(raw);
  const ids = new Set(queries.map((q) => q.partId));
  return { boxes: v.boxes.filter((b) => ids.has(b.partId) && b.w > 0 && b.h > 0).map((b) => ({ ...b, confidence: Math.max(0, Math.min(1, b.confidence)) })) };
}

export async function runOp(name: string, input: unknown): Promise<unknown> {
  const op = OPS[name];
  if (!op) throw new Error(`Unknown model operation: ${name}`);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callModel({ role: op.role, system: SYS[op.role], prompt: op.prompt(input), schema: op.schema });
      return op.validate(raw, input);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
