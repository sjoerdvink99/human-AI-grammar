/** DOM-based SVG helpers (browser / jsdom). */
import type { Rect } from "../types.ts";

export const SHAPE_SELECTOR = "path,rect,circle,ellipse,polygon,polyline,line";

function parse(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGSVGElement;
  if (root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("invalid SVG");
  return root;
}

function serialize(el: Element): string {
  return new XMLSerializer().serializeToString(el);
}

/**
 * Give every drawable shape a stable data-eid (e1, e2…) and every group a data-gid,
 * so segmentation can refer to elements by id. Applied when r8 items arrive.
 */
export function tagElements(svg: string): string {
  const root = parse(svg);
  root.removeAttribute("width");
  root.removeAttribute("height");
  let n = 0;
  root.querySelectorAll(SHAPE_SELECTOR).forEach((el) => {
    if (el.closest("defs,clipPath,mask,pattern,symbol")) return;
    el.setAttribute("data-eid", `e${++n}`);
  });
  let g = 0;
  root.querySelectorAll("g").forEach((el) => el.setAttribute("data-gid", el.getAttribute("id") || `g${++g}`));
  return serialize(root);
}

/** Make ids unique when several SVGs are embedded in one document. */
export function prefixIds(svg: string, prefix: string): string {
  const ids = [...svg.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  let out = svg;
  for (const id of new Set(ids)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`\\bid\\s*=\\s*(["'])${esc}\\1`, "g"), `id="${prefix}${id}"`)
      .replace(new RegExp(`url\\(\\s*#${esc}\\s*\\)`, "g"), `url(#${prefix}${id})`)
      .replace(new RegExp(`href\\s*=\\s*(["'])#${esc}\\1`, "g"), `href="#${prefix}${id}"`);
  }
  return out;
}

/** Strip outer svg wrapper attributes and return a nested <svg> placed at rect. */
export function nestSvg(svg: string, r: Rect, prefix: string, preserve = "xMidYMid meet"): string {
  const p = prefixIds(svg, prefix);
  const open = p.match(/<svg\b[^>]*>/i)![0];
  const vb = open.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? "0 0 100 100";
  const inner = p.slice(open.length, p.lastIndexOf("</svg>"));
  return `<svg x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" viewBox="${vb}" preserveAspectRatio="${preserve}" overflow="visible">${inner}</svg>`;
}

export interface ElementGeometry {
  id: string;
  tag: string;
  group: string;
  fill: string;
  bbox: [number, number, number, number];
}

/** Measure rendered shapes in SVG user units (needs a live, rendered <svg>). */
export function measureElements(svgEl: SVGSVGElement): ElementGeometry[] {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return [];
  const inv = ctm.inverse();
  const toUser = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(inv);
  const out: ElementGeometry[] = [];
  svgEl.querySelectorAll<SVGGraphicsElement>("[data-eid]").forEach((el) => {
    const r = el.getBoundingClientRect();
    const a = toUser(r.left, r.top);
    const b = toUser(r.right, r.bottom);
    out.push({
      id: el.getAttribute("data-eid")!,
      tag: el.tagName.toLowerCase(),
      group: el.parentElement?.closest("g")?.getAttribute("data-gid") ?? "",
      fill: el.getAttribute("fill") ?? (el as unknown as HTMLElement).style?.fill ?? "",
      bbox: [a.x, a.y, b.x - a.x, b.y - a.y],
    });
  });
  return out;
}

export function clientToUser(svgEl: SVGSVGElement, x: number, y: number): { x: number; y: number } {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x, y };
  const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export function unionBox(boxes: [number, number, number, number][]): Rect {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersects(b: [number, number, number, number], r: Rect): boolean {
  return b[0] < r.x + r.w && b[0] + b[2] > r.x && b[1] < r.y + r.h && b[1] + b[3] > r.y;
}

/** tool_2 extract (part): keep only the given elements and frame their bbox. r11 + r13 item -> r15 item */
export function cropSvg(svg: string, elementIds: string[], bbox: Rect, pad = 2): string {
  const root = parse(svg);
  const keep = new Set(elementIds);
  root.querySelectorAll("[data-eid]").forEach((el) => {
    if (!keep.has(el.getAttribute("data-eid")!)) el.remove();
  });
  root.querySelectorAll("text").forEach((el) => el.remove());
  // drop now-empty groups
  [...root.querySelectorAll("g")].reverse().forEach((g) => {
    if (!g.querySelector("[data-eid]")) g.remove();
  });
  root.setAttribute(
    "viewBox",
    `${(bbox.x - pad).toFixed(1)} ${(bbox.y - pad).toFixed(1)} ${(bbox.w + 2 * pad).toFixed(1)} ${(bbox.h + 2 * pad).toFixed(1)}`,
  );
  root.removeAttribute("width");
  root.removeAttribute("height");
  return serialize(root);
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
