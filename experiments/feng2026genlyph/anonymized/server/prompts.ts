/**
 * One prompt per model operation in the design. Each builder takes only the
 * representations present in the state that precedes the model step.
 */
import { CANVAS } from "../src/tools/sanitize.ts";

/** model_1 generate: r3 (data description) -> r4 (theme brainstorm) */
export function themesPrompt(r3: string) {
  return {
    system:
      "You are a creative director for data illustration. You propose visual metaphors that make a dataset feel concrete.",
    prompt: `Here is a description of a dataset:

${r3}

Propose 6 visual concepts for an illustrated (pictorial) chart of this data. Each concept must be a scene or set of
physical objects that can stand for the data's categories and whose size or count can encode the values.
Write them as a numbered list, one per line, formatted exactly as:
1. <short concept title> — <one sentence describing the scene and which object represents each category>
Write nothing else.`,
  };
}

/** model_2 generate: r7 / r10 (illustration prompt) -> r8 (SVG illustration) */
export function illustratePrompt(r7: string) {
  return {
    system:
      "You are a vector illustrator who writes clean, hand-crafted SVG. You output only SVG markup, no explanations.",
    prompt: `${r7}

Technical requirements:
- Output a single <svg> element with xmlns and viewBox="0 0 ${CANVAS.width} ${CANVAS.height}". No width/height attributes.
- Flat vector style, cohesive palette of 4–7 colours, a simple background.
- Draw every distinct object as its own <g> group with an id that names it (e.g. id="apple-1").
- Use only path, rect, circle, ellipse, polygon, polyline, line, g, defs, linearGradient, radialGradient, stop.
- No text, no <image>, no scripts, no filters. At most 150 shape elements.
Output only the SVG.`,
  };
}

export interface SegElement {
  id: string;
  tag: string;
  group: string;
  fill: string;
  bbox: [number, number, number, number];
}

/** model_3 extract: r11 (illustration geometry) + r12 (user rectangles) -> r13 (segments) */
export function segmentPrompt(elements: SegElement[], selections: { x: number; y: number; w: number; h: number }[]) {
  return {
    system:
      "You segment SVG illustrations into meaningful objects. You reply with strict JSON only, no prose.",
    prompt: `An SVG illustration (canvas ${CANVAS.width}x${CANVAS.height}) has these shape elements that overlap the user's
selection rectangles. Each line: id | tag | enclosing group id | fill | bbox [x, y, w, h].

${elements.map((e) => `${e.id} | ${e.tag} | ${e.group || "-"} | ${e.fill || "-"} | [${e.bbox.map((v) => Math.round(v)).join(", ")}]`).join("\n")}

User selection rectangles [x, y, w, h]:
${selections.map((s, i) => `S${i + 1}: [${[s.x, s.y, s.w, s.h].map(Math.round).join(", ")}]`).join("\n")}

Each rectangle marks one object (or several similar objects) the user wants as a separate segment. For each rectangle,
group the elements that make up each whole object inside it (use group ids and geometry; include small parts like stems
or highlights; exclude background shapes that extend far beyond the rectangle). An element belongs to at most one segment.
Reply with JSON: {"segments":[{"name":"<short object name>","selection":<rectangle number>,"elementIds":["e1","e2"]}]}`,
  };
}

/** model_4 generate: r15 (cropped element SVG) + r14 (its label) -> r17 (description) */
export function describePrompt(r15: string, label: { name: string; field?: string }) {
  return {
    system: "You describe vector graphics precisely and briefly for an illustrator. Reply with plain text only.",
    prompt: `This SVG is one element cropped from an illustration. The user named it "${label.name}"${
      label.field ? ` and will use it to represent values of the data field "${label.field}"` : ""
    }.

${r15}

Describe in 1–2 sentences what it depicts and its visual style: shapes, colours (with hex codes), outline, shading,
proportions. Do not mention SVG or code.`,
  };
}

/** model_5 generate: r18 (variant prompt) + r16 (its aspect) -> r19 (variant SVG) */
export function variantPrompt(r18: string, r16: { w: number; h: number }) {
  const w = 100;
  const h = Math.max(20, Math.round((100 * r16.h) / Math.max(r16.w, 1)));
  return {
    system:
      "You are a vector illustrator who draws consistent icon sets in SVG. You output only SVG markup, no explanations.",
    prompt: `${r18}

Technical requirements:
- Output a single standalone <svg> with xmlns and viewBox="0 0 ${w} ${h}" (keep this aspect ratio), no width/height.
- The object fills the viewBox with a little margin, transparent background, no text, no <image>, no scripts.
- Use only path, rect, circle, ellipse, polygon, polyline, line, g, defs, gradients. At most 60 elements.
Output only the SVG.`,
  };
}
