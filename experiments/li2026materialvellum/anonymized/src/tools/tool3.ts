// tool_3 — composer / renderer. Implements every `[tool_3 …]` step in the design:
//   P1.3  compose    r2_2* → r3_1                       composeLayout
//   P1.5  translate  r4_1 → r4_1 + r5_1                 deriveCamera
//   P1.8  translate  r4_2 → r6_1                        renderScene
//   P1.12 translate  r8_2* → r9_1* + r10_1*             strokesToSelections
//   P2.3  translate  r12_2* → r13_1 + r14_1             renderShapes + describeSketch
//   P3.4  translate  r19_1* → r20_1*                    transcriptToCategory
//   P3.5  compose    r16 + r18_2* + r20_1* → r21_1*     composeRecords
//   P3.8  compose    r21* + r22* + r23* → r24_1         composeCollage
import {
  CANVAS_H, CANVAS_W, CATEGORIES,
  type BBox, type Box, type Camera, type Category, type ItemImage, type ItemRecord, type Label,
  type Layout, type Point, type RegionSelection, type Scene3D, type Shape, type SvgImage,
} from "../shared/types";
import { basisOf, clipNear, cross, dot, eyeOf, norm, project, sub, toCamera, v3 } from "./math3d";
import { bboxOf } from "./tool1";

const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (p: Point[]) => p.map((q) => `${r1(q.x)},${r1(q.y)}`).join(" ");
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

// ---------------------------------------------------------------- P1.3 composeLayout

export const PX_PER_M = 20;

/** Pen colours on the ground plan encode building height. */
export const HEIGHT_PENS = [
  { color: "#8d6e63", label: "Low (4 m)", height: 4 },
  { color: "#5c6bc0", label: "Mid (12 m)", height: 12 },
  { color: "#26a69a", label: "Tall (30 m)", height: 30 },
] as const;

export function composeLayout(shapes: Shape[], width = CANVAS_W, height = CANVAS_H): Layout {
  return {
    footprints: shapes
      .filter((s) => s.closed && s.points.length >= 3 && s.bbox.w > 4 && s.bbox.h > 4)
      .map((s) => ({
        id: s.id,
        polygon: s.points.map((p) => ({ x: p.x / PX_PER_M, y: p.y / PX_PER_M })),
        height: HEIGHT_PENS.find((h) => h.color === s.color)?.height ?? 8,
        color: s.color,
      })),
    extent: { w: width / PX_PER_M, d: height / PX_PER_M },
  };
}

// ---------------------------------------------------------------- P1.5 deriveCamera

export function deriveCamera(scene: Scene3D): Camera {
  const maxH = Math.max(4, ...scene.prisms.map((p) => p.height));
  const diag = Math.hypot(scene.ground.w, scene.ground.d);
  return { yaw: 30, pitch: 30, distance: Math.max(25, diag * 0.85 + maxH * 0.8), fov: 50, target: v3(0, maxH * 0.3, 0) };
}

// ---------------------------------------------------------------- P1.8 renderScene

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c.join(",")})`;
}

/** Perspective SVG render of the block scene with Lambert shading and depth fog. */
export function renderScene(scene: Scene3D, w = CANVAS_W, h = CANVAS_H): SvgImage {
  const cam = scene.camera;
  if (!cam) throw new Error("renderScene needs a scene with a camera (r4_2)");
  const b = basisOf(cam);
  const eye = eyeOf(cam);
  const light = norm(v3(-0.5, 1, 0.35));
  type Face = { world: import("../shared/types").Vec3[]; fill: string; depth: number; stroke: string };
  const faces: Face[] = [];
  const maxDepth = cam.distance * 2.2;

  for (const pr of scene.prisms) {
    const base = pr.base;
    const top = base.map((p) => v3(p.x, pr.height, p.z));
    const c = base.reduce((a, p) => v3(a.x + p.x / base.length, 0, a.z + p.z / base.length), v3(0, 0, 0));
    for (let i = 0; i < base.length; i++) {
      const a = base[i], bb = base[(i + 1) % base.length];
      const quad = [a, bb, top[(i + 1) % base.length], top[i]];
      let n = norm(cross(sub(bb, a), v3(0, 1, 0)));
      const mid = v3((a.x + bb.x) / 2, 0, (a.z + bb.z) / 2);
      if (dot(n, sub(mid, c)) < 0) n = v3(-n.x, -n.y, -n.z);
      const toEye = sub(eye, v3(mid.x, pr.height / 2, mid.z));
      if (dot(n, toEye) <= 0) continue; // back face
      const lam = 0.45 + 0.55 * Math.max(0, dot(n, light));
      faces.push({ world: quad, fill: shade(pr.color, lam), depth: 0, stroke: shade(pr.color, 0.45) });
    }
    if (eye.y > pr.height) faces.push({ world: top, fill: shade(pr.color, 1.15), depth: 0, stroke: shade(pr.color, 0.5) });
  }

  const toScreen = (poly: import("../shared/types").Vec3[]) => {
    const camPts = clipNear(poly.map((p) => toCamera(p, b)));
    return { screen: camPts.map((p) => project(p, cam, w, h)), depth: camPts.reduce((s, p) => s + p.z, 0) / (camPts.length || 1) };
  };

  // Ground and grid
  const gw = scene.ground.w / 2, gd = scene.ground.d / 2;
  const ground = toScreen([v3(-gw, 0, -gd), v3(gw, 0, -gd), v3(gw, 0, gd), v3(-gw, 0, gd)]);
  const grid: string[] = [];
  for (let x = -gw; x <= gw + 1e-6; x += 5) {
    const l = toScreen([v3(x, 0, -gd), v3(x, 0, gd), v3(x, 0, gd)]);
    if (l.screen.length >= 2) grid.push(`<polyline points="${pts(l.screen)}" fill="none"/>`);
  }
  for (let z = -gd; z <= gd + 1e-6; z += 5) {
    const l = toScreen([v3(-gw, 0, z), v3(gw, 0, z), v3(gw, 0, z)]);
    if (l.screen.length >= 2) grid.push(`<polyline points="${pts(l.screen)}" fill="none"/>`);
  }

  const drawn = faces
    .map((f) => ({ ...f, ...toScreen(f.world) }))
    .filter((f) => f.screen.length >= 3)
    .sort((a, b2) => b2.depth - a.depth)
    .map((f) => {
      const fog = Math.min(0.55, Math.max(0, f.depth / maxDepth) * 0.6);
      return `<polygon points="${pts(f.screen)}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="1"/>` +
        (fog > 0.02 ? `<polygon points="${pts(f.screen)}" fill="#dfe8f2" opacity="${r1(fog * 100) / 100}"/>` : "");
    });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9d4ee"/><stop offset="1" stop-color="#eef3f8"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
${ground.screen.length >= 3 ? `<polygon points="${pts(ground.screen)}" fill="#c9cfc2"/>` : ""}
<g stroke="#aab2a4" stroke-width="0.7">${grid.join("")}</g>
${drawn.join("\n")}
</svg>`;
}

// ---------------------------------------------------------------- P1.12 strokesToSelections

const INTENT_TEXT: Record<string, (s: Shape) => string> = {
  "remove": () => "Remove whatever is inside this region and fill it plausibly with the surrounding background.",
  "add-detail": () => "Add richer detail inside this region (texture, small objects, windows, foliage as appropriate) without changing its overall shapes.",
  "brighten": () => "Make this region noticeably brighter and lighter in tone.",
  "darken": () => "Make this region noticeably darker, as if in shadow.",
  "recolor": (s) => `Recolor the main content of this region to ${s.recolorTo ?? "#0091ff"} while keeping its shapes.`,
  "replace-sky": () => "Replace the content of this region with open sky.",
};

function positionWords(bb: BBox, w = CANVAS_W, h = CANVAS_H): string {
  const cx = (bb.x + bb.w / 2) / w, cy = (bb.y + bb.h / 2) / h;
  const v = cy < 0.33 ? "upper" : cy > 0.66 ? "lower" : "middle";
  const hz = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "center";
  return v === "middle" && hz === "center" ? "center" : `${v} ${hz}`;
}

export function strokesToSelections(shapes: Shape[]): { selections: RegionSelection[]; instructions: string[] } {
  const closed = shapes.filter((s) => s.points.length >= 3 && s.bbox.w > 3 && s.bbox.h > 3);
  const selections = closed.map((s, i) => ({ id: s.id, index: i + 1, polygon: s.points, bbox: s.bbox }));
  const instructions = closed.map((s, i) => {
    const bb = s.bbox;
    return `Region ${i + 1} (${positionWords(bb)}, bbox x=${Math.round(bb.x)} y=${Math.round(bb.y)} w=${Math.round(bb.w)} h=${Math.round(bb.h)}): ${INTENT_TEXT[s.intent ?? "add-detail"](s)}`;
  });
  return { selections, instructions };
}

// ---------------------------------------------------------------- P2.3 renderShapes + describeSketch

export function renderShapes(shapes: Shape[], w = CANVAS_W, h = CANVAS_H): SvgImage {
  const els = shapes.map((s) =>
    s.closed
      ? `<polygon points="${pts(s.points)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round"/>`
      : `<polyline points="${pts(s.points)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${els.join("")}</svg>`;
}

const COLOR_NAMES: Record<string, string> = {
  "#1f2328": "black", "#e5484d": "red", "#f76b15": "orange", "#f5d90a": "yellow", "#30a46c": "green",
  "#0091ff": "blue", "#8e4ec6": "purple", "#8d6e63": "brown", "#68ddfd": "light blue",
};
export const SKETCH_PENS = Object.entries(COLOR_NAMES).map(([color, name]) => ({ color, name }));

export function describeSketch(shapes: Shape[], w = CANVAS_W, h = CANVAS_H): string {
  if (shapes.length === 0) return "An empty sketch.";
  const sizeWord = (bb: BBox) => {
    const a = (bb.w * bb.h) / (w * h);
    return a > 0.25 ? "large" : a > 0.04 ? "medium-sized" : "small";
  };
  const kindWord: Record<string, string> = {
    line: "straight line", rectangle: "rectangle", ellipse: "ellipse", triangle: "triangle",
    polygon: "polygon", freeform: "freehand curve",
  };
  const lines = shapes.map((s, i) => {
    const color = COLOR_NAMES[s.color] ?? s.color;
    let extra = "";
    if (s.kind === "line") {
      const [a, b] = s.points;
      const ang = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 180;
      extra = ang < 20 || ang > 160 ? ", horizontal" : ang > 70 && ang < 110 ? ", vertical" : ", diagonal";
    } else if (s.kind === "ellipse" && Math.abs(s.bbox.w - s.bbox.h) < 0.15 * Math.max(s.bbox.w, s.bbox.h)) {
      extra = ", nearly circular";
    } else if (s.kind === "freeform") {
      extra = s.closed ? ", closed outline" : ", open stroke";
    }
    return `${i + 1}. A ${sizeWord(s.bbox)} ${color} ${kindWord[s.kind]}${extra} in the ${positionWords(s.bbox, w, h)} (bbox x=${Math.round(s.bbox.x)} y=${Math.round(s.bbox.y)} w=${Math.round(s.bbox.w)} h=${Math.round(s.bbox.h)}).`;
  });
  return `A sketch on a ${w}x${h} canvas with ${shapes.length} element${shapes.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------- P3.4 transcriptToCategory

const SYNONYMS: Record<Category, string[]> = {
  person: ["person", "man", "woman", "boy", "girl", "child", "kid", "people", "human", "lady", "guy", "me", "friend"],
  animal: ["animal", "dog", "cat", "bird", "horse", "cow", "puppy", "kitten", "fish", "rabbit", "bear", "fox", "duck", "sheep", "lion"],
  tree: ["tree", "trees", "oak", "pine", "palm", "forest", "bush"],
  flower: ["flower", "flowers", "rose", "tulip", "daisy", "sunflower", "plant", "garden"],
  house: ["house", "home", "cottage", "cabin", "hut"],
  building: ["building", "tower", "skyscraper", "castle", "church", "office", "school", "shop"],
  car: ["car", "truck", "bus", "taxi", "vehicle", "van", "bike", "bicycle"],
  boat: ["boat", "ship", "sailboat", "yacht", "canoe"],
  mountain: ["mountain", "mountains", "hill", "hills", "volcano", "peak"],
  sun: ["sun", "sunny", "sunset", "sunrise"],
  moon: ["moon", "crescent", "star", "stars"],
  cloud: ["cloud", "clouds", "cloudy", "rain", "storm"],
  water: ["water", "lake", "river", "sea", "ocean", "pond", "waves"],
  table: ["table", "desk"],
  chair: ["chair", "bench", "sofa", "couch", "stool"],
  food: ["food", "cake", "apple", "pizza", "bread", "fruit", "banana", "sandwich", "cookie"],
};

/** Deterministic speech-transcript → category from the fixed set (null when nothing matches). */
export function transcriptToCategory(transcript: string): Category | null {
  const words = transcript.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  // Prefer the first mentioned category: in "a dog sitting under a tree" the subject comes first.
  let first: { cat: Category; pos: number } | null = null;
  for (const cat of CATEGORIES) {
    for (const syn of SYNONYMS[cat]) {
      const pos = words.indexOf(syn);
      if (pos >= 0 && (!first || pos < first.pos)) first = { cat, pos };
    }
  }
  return first?.cat ?? null;
}

// ---------------------------------------------------------------- P3.5 composeRecords

export function composeRecords(globalPrompt: string, boxes: Box[], labels: Label[]): ItemRecord[] {
  return boxes.flatMap((b) => {
    const l = labels.find((x) => x.boxId === b.id);
    if (!l?.category) return [];
    return [{
      boxId: b.id,
      label: l.category,
      region: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) },
      position: positionWords(b),
      globalPrompt: globalPrompt.trim(),
    }];
  });
}

// ---------------------------------------------------------------- P3.8 composeCollage

/** Split an SVG document into its viewBox and inner markup, prefixing ids so several can be nested. */
export function unwrapSvg(svg: string, idPrefix: string): { viewBox: string; inner: string } {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error("not an svg");
  const vb = open[0].match(/viewBox\s*=\s*"([^"]+)"/i)?.[1];
  const wAttr = open[0].match(/\swidth\s*=\s*"([\d.]+)/i)?.[1];
  const hAttr = open[0].match(/\sheight\s*=\s*"([\d.]+)/i)?.[1];
  const viewBox = vb ?? `0 0 ${wAttr ?? 512} ${hAttr ?? 512}`;
  let inner = svg.slice(svg.indexOf(open[0]) + open[0].length, svg.toLowerCase().lastIndexOf("</svg>"));
  inner = inner
    .replace(/\bid\s*=\s*"([^"]+)"/g, (_m, id) => `id="${idPrefix}${id}"`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, id) => `url(#${idPrefix}${id})`)
    .replace(/(xlink:href|href)\s*=\s*"#([^"]+)"/g, (_m, a, id) => `${a}="#${idPrefix}${id}"`);
  return { viewBox, inner };
}

export function composeCollage(records: ItemRecord[], images: ItemImage[], globalPrompt: string, w = CANVAS_W, h = CANVAS_H): SvgImage {
  // Larger regions first so small items sit on top.
  const ordered = records.slice().sort((a, b) => b.region.w * b.region.h - a.region.w * a.region.h);
  const parts = ordered.map((r, i) => {
    const img = images.find((x) => x.boxId === r.boxId);
    if (!img) return "";
    const { viewBox, inner } = unwrapSvg(img.svg, `i${i}_`);
    return `<svg x="${r.region.x}" y="${r.region.y}" width="${r.region.w}" height="${r.region.h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><title>${esc(globalPrompt)}</title><rect width="${w}" height="${h}" fill="#ffffff"/>${parts.join("")}</svg>`;
}

export { bboxOf };
