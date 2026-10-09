// tool_1 — deterministic image / geometry / export utilities.
// Every function here is pure (no DOM) so it can be unit-tested; the one DOM-bound
// tool (silhouette extraction) lives in src/web/svgdom.ts.

import type {
  Box2D, BoxCheck, Constraints, Dim, ExportBundle, ExportFormat, Part3D, PartRecord,
  Placement3D, PlannedPart, Svg, Assembly,
} from "./types";

export const CANVAS = 512;
let idCounter = 0;
export const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const MATERIAL_COLORS: [RegExp, string][] = [
  [/oak|wood|ply|birch|pine|walnut|bamboo|mdf/i, "#c8a27a"],
  [/steel|metal|alumin|iron|brass|chrome/i, "#9aa3ad"],
  [/plastic|pla|abs|petg|acrylic|resin/i, "#7fb3e0"],
  [/fabric|cushion|foam|leather|textile|felt/i, "#b4a7d6"],
  [/glass/i, "#a8dbe6"],
  [/cardboard|paper/i, "#d9b98c"],
];
export function materialColor(material: string): string {
  for (const [re, c] of MATERIAL_COLORS) if (re.test(material)) return c;
  return "#d6cfc2";
}

// ---------- SVG helpers ----------

/** Strip active content from model-produced SVG and require a single <svg> root. */
export function sanitizeSvg(raw: string): Svg {
  let s = raw.trim();
  const start = s.search(/<svg[\s>]/i);
  const end = s.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error("Output is not an SVG document");
  s = s.slice(start, end + 6);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href\s*=\s*)("|')(?!#|data:image\/)[^"']*\2/gi, '$1$2#$2');
  if (!/xmlns=/.test(s.slice(0, s.indexOf(">")))) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

function openTag(svg: Svg): { open: string; inner: string } {
  const i = svg.indexOf(">");
  const j = svg.toLowerCase().lastIndexOf("</svg>");
  return { open: svg.slice(0, i + 1), inner: svg.slice(i + 1, j) };
}

/** Read the viewBox (or width/height) of an SVG. */
export function viewBoxOf(svg: Svg): { x: number; y: number; w: number; h: number } {
  const { open } = openTag(svg);
  const vb = open.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const [x, y, w, h] = vb[1].trim().split(/[\s,]+/).map(Number);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return { x, y, w, h };
  }
  const w = parseFloat(open.match(/\swidth\s*=\s*["']([\d.]+)/i)?.[1] ?? "");
  const h = parseFloat(open.match(/\sheight\s*=\s*["']([\d.]+)/i)?.[1] ?? "");
  return { x: 0, y: 0, w: w > 0 ? w : CANVAS, h: h > 0 ? h : CANVAS };
}

/** tool_1 modify (P4): r3 → r10. Fit the concept image into a 512×512 canvas on white. */
export function normalizeReference(svg: Svg): Svg {
  const clean = sanitizeSvg(svg);
  const vb = viewBoxOf(clean);
  const { open, inner } = openTag(clean);
  const s = Math.min(CANVAS / vb.w, CANVAS / vb.h);
  const tx = (CANVAS - vb.w * s) / 2;
  const ty = (CANVAS - vb.h * s) / 2;
  const xlink = /xmlns:xlink/.test(open) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : "";
  return `<svg xmlns="http://www.w3.org/2000/svg"${xlink} viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">` +
    `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="#ffffff" data-bg="1"/>` +
    `<g transform="translate(${r2(tx)} ${r2(ty)}) scale(${r4(s)}) translate(${r2(-vb.x)} ${r2(-vb.y)})">${inner}</g></svg>`;
}

/** tool_1 extract (P8): crop an SVG to a box (plus padding) by rewriting its viewBox. */
export function cropSvg(svg: Svg, box: { x: number; y: number; w: number; h: number }, pad = 0.08): Svg {
  const px = box.w * pad, py = box.h * pad;
  const vb = `${r2(box.x - px)} ${r2(box.y - py)} ${r2(box.w + 2 * px)} ${r2(box.h + 2 * py)}`;
  const { open, inner } = openTag(svg);
  let o = open.replace(/\sviewBox\s*=\s*["'][^"']*["']/i, "").replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "");
  o = o.replace(/<svg/i, `<svg viewBox="${vb}" width="${r2(box.w + 2 * px)}" height="${r2(box.h + 2 * py)}"`);
  return o + inner + "</svg>";
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------- parts ----------

function zFromHint(hint: PartRecord["zHint"], depth: number, totalDepth: number): number {
  const off = Math.max(0, totalDepth / 2 - depth / 2);
  return hint === "front" ? off : hint === "back" ? -off : 0;
}

/** tool_1 modify (P4): r8* → initial r11*. Parts laid out side by side on the ground. */
export function initialParts(records: PartRecord[]): Part3D[] {
  let x = 0;
  const parts = records.map((r) => {
    const p: Part3D = {
      id: r.id, name: r.name, shape: r.shape, size: { ...r.size },
      position: { x: x + r.size.w / 2, y: r.size.h / 2, z: 0 }, rotationY: 0,
      color: materialColor(r.material), material: r.material, source: "r8 record",
    };
    x += r.size.w + 40;
    return p;
  });
  const shift = x > 0 ? (x - 40) / 2 : 0;
  parts.forEach((p) => (p.position.x -= shift));
  return parts;
}

function unionBox(boxes: { x: number; y: number; w: number; h: number }[]) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * tool_1 translate (P4): r13* (front-view boxes in r10) → r11_2*.
 * The union of all boxes is mapped onto the selected overall width × height; depth comes from the record.
 */
export function boxesToParts(parts: Part3D[], records: PartRecord[], boxes: Box2D[], dims: Dim): Part3D[] {
  const valid = boxes.filter((b) => b.w > 0 && b.h > 0);
  if (!valid.length) return parts.map((p) => ({ ...p }));
  const U = unionBox(valid);
  const sx = dims.w / Math.max(U.w, 1), sy = dims.h / Math.max(U.h, 1);
  const cx = U.x + U.w / 2, bottom = U.y + U.h;
  return parts.map((p) => {
    const b = valid.find((v) => v.partId === p.id);
    const rec = records.find((r) => r.id === p.id);
    if (!b) return { ...p };
    const w = Math.max(1, b.w * sx), h = Math.max(1, b.h * sy);
    const d = p.shape === "cylinder" ? w : Math.max(1, rec?.size.d ?? p.size.d);
    return {
      ...p,
      size: { w: r2(w), h: r2(h), d: r2(d) },
      position: {
        x: r2((b.x + b.w / 2 - cx) * sx),
        y: r2((bottom - (b.y + b.h / 2)) * sy),
        z: r2(zFromHint(rec?.zHint ?? "center", d, dims.d)),
      },
      imageBox: { ...b },
      source: "r13 grounding",
    };
  });
}

function iou(a: Box2D, b: Box2D): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

/** tool_1 evaluate (P5): r13* or r16* → r15*. */
export function checkBoxes(boxes: Box2D[], records: PartRecord[]): BoxCheck[] {
  return records.map((rec) => {
    const b = boxes.find((x) => x.partId === rec.id);
    if (!b) return { partId: rec.id, pass: false, issues: ["not grounded"], maxOverlap: 0, areaFraction: 0 };
    const issues: string[] = [];
    const tol = 4;
    if (b.x < -tol || b.y < -tol || b.x + b.w > CANVAS + tol || b.y + b.h > CANVAS + tol) issues.push("outside the image");
    const areaFraction = (b.w * b.h) / (CANVAS * CANVAS);
    if (b.w < 2 || b.h < 2 || areaFraction < 0.0004) issues.push("box too small");
    if (areaFraction > 0.9 && records.length > 1) issues.push("box covers the whole image");
    const others = boxes.filter((o) => o.partId !== b.partId);
    const maxOverlap = others.length ? Math.max(...others.map((o) => iou(b, o))) : 0;
    if (maxOverlap > 0.85) issues.push(`duplicates another part (IoU ${maxOverlap.toFixed(2)})`);
    if (rec.size.w > 0 && rec.size.h > 0 && b.w > 0 && b.h > 0) {
      const expected = rec.size.h / rec.size.w, got = b.h / b.w;
      if (Math.abs(Math.log(got / expected)) > Math.log(4)) issues.push(`aspect ${got.toFixed(2)} vs expected ${expected.toFixed(2)}`);
    }
    if (b.confidence < 0.3) issues.push(`low confidence ${b.confidence.toFixed(2)}`);
    return { partId: rec.id, pass: issues.length === 0, issues, maxOverlap: r2(maxOverlap), areaFraction: r4(areaFraction) };
  });
}

/**
 * tool_1 translate (P5): r16* + r17* + r18* → r19*.
 * Front boxes give width/height/position, side-view silhouettes give depth and a profile extruded across x.
 */
export function refinePartsFromViews(
  parts: Part3D[], records: PartRecord[], boxes: Box2D[], dims: Dim,
  sideViews: { partId: string; svg: Svg }[], sideBoxes: Box2D[],
): Part3D[] {
  const base = boxesToParts(parts, records, boxes, dims);
  return base.map((p) => {
    const sb = sideBoxes.find((b) => b.partId === p.id);
    const sv = sideViews.find((v) => v.partId === p.id);
    if (!sb || !sv || sb.h <= 0 || sb.w <= 0) return p;
    const d = clamp(p.size.h * (sb.w / sb.h), 1, Math.max(dims.d * 1.5, 10));
    if (p.shape === "cylinder") return { ...p, size: { ...p.size, d: r2(d), w: r2(d) }, source: "r19 side view" };
    return {
      ...p, shape: "profile", profileAxis: "x", profileSvg: cropSvg(sv.svg, sb, 0),
      size: { ...p.size, d: r2(d) }, source: "r19 side view",
    };
  });
}

/** tool_1 translate (P6, P8): a clean part image + its silhouette box → a profiled 3D part. */
export function imageToPart(
  svg: Svg, box: Box2D, opts: { id?: string; name: string; height: number; width?: number; depth: number; material: string; position?: Part3D["position"]; rotationY?: number },
): Part3D {
  const h = Math.max(1, opts.height);
  const w = opts.width && opts.width > 0 ? opts.width : box.h > 0 ? h * (box.w / box.h) : h;
  return {
    id: opts.id ?? uid("part"), name: opts.name, shape: "profile", profileAxis: "z",
    profileSvg: cropSvg(svg, box, 0), size: { w: r2(w), h: r2(h), d: r2(Math.max(1, opts.depth)) },
    position: opts.position ? { ...opts.position } : { x: 0, y: h / 2, z: 0 }, rotationY: opts.rotationY ?? 0,
    color: materialColor(opts.material), material: opts.material, source: "image → part",
  };
}

/** tool_1 translate (P9): r35* + r36* → r37*. */
export function placementsToParts(planned: PlannedPart[], placements: Placement3D[]): (Part3D & { replacesId: string | null })[] {
  return planned.flatMap((pl) => {
    const at = placements.find((p) => p.key === pl.key);
    if (!at) return [];
    const size = {
      w: r2(Math.max(1, at.size.w)), h: r2(Math.max(1, at.size.h)),
      d: r2(Math.max(1, pl.shape === "cylinder" ? at.size.w : at.size.d)),
    };
    return [{
      id: pl.replacesId ?? uid("part"), name: pl.name, shape: pl.shape, size,
      position: { x: r2(at.position.x), y: r2(at.position.y), z: r2(at.position.z) }, rotationY: 0,
      color: materialColor(pl.material), material: pl.material, source: "language edit", replacesId: pl.replacesId,
    }];
  });
}

// ---------- export (P11) ----------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "part";
/** Unique, readable identifier for a part: its id, prefixed with its name when they differ. */
const partKey = (p: Part3D) => (slug(p.id).startsWith(slug(p.name)) ? slug(p.id) : `${slug(p.name)}_${slug(p.id)}`);

/** One OpenSCAD module per part. OpenSCAD is z-up: (x, y, z)app → (x, -z, y)scad. */
export function partToScad(p: Part3D): string {
  const { w, h, d } = p.size;
  const t = `translate([${r2(p.position.x)}, ${r2(-p.position.z)}, ${r2(p.position.y)}]) rotate([0, 0, ${r2(p.rotationY)}])`;
  const body = p.shape === "cylinder"
    ? `cylinder(d = ${r2(w)}, h = ${r2(h)}, center = true, $fn = 64);`
    : `cube([${r2(w)}, ${r2(d)}, ${r2(h)}], center = true);${p.shape === "profile" ? " // profile part: bounding block; see the SVG drawing for the outline" : ""}`;
  return `// ${p.name} (${p.material})\nmodule ${partKey(p)}() {\n  ${t}\n    ${body}\n}\n`;
}

export function toOpenScad(assembly: Assembly, name: string): { name: string; content: string }[] {
  const perPart = assembly.parts.map((p) => ({ name: `parts/${partKey(p)}.scad`, content: partToScad(p) + `\n${partKey(p)}();\n` }));
  const all = `// ${name} — assembly (units: mm)\n\n${assembly.parts.map(partToScad).join("\n")}\n` +
    assembly.parts.map((p) => `color("${p.color}") ${partKey(p)}();`).join("\n") + "\n";
  return [{ name: `${slug(name)}_assembly.scad`, content: all }, ...perPart];
}

/** Dimensioned drawing: front view (w×h) and side view (d×h), outline when the part has a profile. */
export function toDrawingSvg(p: Part3D, c: Constraints): Svg {
  const { w, h, d } = p.size;
  const scale = 260 / Math.max(w + d + 40, h, 1);
  const fw = w * scale, fh = h * scale, sw = d * scale;
  const W = fw + sw + 140, H = fh + 120;
  const ox = 40, oy = 50, sx = ox + fw + 60;
  const outline = p.shape === "profile" && p.profileSvg
    ? `<svg x="${p.profileAxis === "x" ? sx : ox}" y="${oy}" width="${p.profileAxis === "x" ? sw : fw}" height="${fh}" preserveAspectRatio="none" viewBox="${(() => { const v = viewBoxOf(p.profileSvg); return `${v.x} ${v.y} ${v.w} ${v.h}`; })()}" opacity="0.55">${openTag(p.profileSvg).inner}</svg>`
    : "";
  const front = p.shape === "cylinder"
    ? `<rect x="${ox}" y="${oy}" width="${fw}" height="${fh}" rx="2" fill="none" stroke="#222"/>`
    : `<rect x="${ox}" y="${oy}" width="${fw}" height="${fh}" fill="none" stroke="#222"/>`;
  const side = `<rect x="${sx}" y="${oy}" width="${sw}" height="${fh}" fill="none" stroke="#222"/>`;
  const txt = (x: number, y: number, s: string, anchor = "middle") => `<text x="${r2(x)}" y="${r2(y)}" font-size="11" font-family="monospace" text-anchor="${anchor}">${s}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(W)} ${r2(H)}" width="${r2(W)}" height="${r2(H)}">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    txt(10, 20, `${escapeXml(p.name)} — ${escapeXml(p.material)} — ${c.method}`, "start") +
    outline + front + side +
    txt(ox + fw / 2, oy - 8, `${r2(w)} mm`) + txt(ox - 6, oy + fh / 2, `${r2(h)}`, "end") +
    txt(sx + sw / 2, oy - 8, `${r2(d)} mm`) +
    txt(ox + fw / 2, oy + fh + 18, "FRONT") + txt(sx + sw / 2, oy + fh + 18, "SIDE") +
    `</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
}

/** tool_1 compose (P11): r43* + r44* + r45 → r46. */
export function composeExport(
  format: ExportFormat, name: string, assembly: Assembly, constraints: Constraints,
  scad: { name: string; content: string }[], drawings: { name: string; content: string }[],
): ExportBundle {
  const bom = assembly.parts.map((p) => ({ id: p.id, name: p.name, material: p.material, w: p.size.w, h: p.size.h, d: p.size.d }));
  const files: ExportBundle["files"] = [];
  if (format === "openscad" || format === "full") files.push(...scad.map((f) => ({ ...f, mime: "text/plain" })));
  if (format === "drawings" || format === "full") files.push(...drawings.map((f) => ({ ...f, mime: "image/svg+xml" })));
  if (format === "full") {
    files.push({
      name: "bom.csv", mime: "text/csv",
      content: "id,name,material,w_mm,h_mm,d_mm\n" + bom.map((b) => [b.id, JSON.stringify(b.name), JSON.stringify(b.material), b.w, b.h, b.d].join(",")).join("\n") + "\n",
    });
    files.push({ name: "assembly.json", mime: "application/json", content: JSON.stringify({ constraints, assembly }, null, 2) });
  }
  return { format, createdAt: new Date().toISOString(), name, bom, files };
}
