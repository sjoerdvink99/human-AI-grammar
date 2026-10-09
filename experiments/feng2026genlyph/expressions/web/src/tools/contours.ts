import type { BBox, Contour, Fragment, EncodingVariant } from '../types';
import { loadImage, svgToDataUrl, viewBoxOf } from './svgutil';

const RES = 128;

/** Andrew's monotone chain convex hull. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Opaque-pixel boundary points of an SVG, in its viewBox coordinates. */
async function opaquePoints(svg: string): Promise<[number, number][]> {
  const [vx, vy, vw, vh] = viewBoxOf(svg);
  const sized = svg.replace(/<svg\b/, `<svg width="${RES}" height="${RES}" preserveAspectRatio="none"`);
  const img = await loadImage(svgToDataUrl(sized));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RES;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, RES, RES);
  const data = ctx.getImageData(0, 0, RES, RES).data;
  const pts: [number, number][] = [];
  for (let y = 0; y < RES; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < RES; x++) if (data[(y * RES + x) * 4 + 3] > 24) { if (first < 0) first = x; last = x; }
    if (first >= 0) {
      pts.push([vx + (first / RES) * vw, vy + (y / RES) * vh]);
      pts.push([vx + ((last + 1) / RES) * vw, vy + ((y + 1) / RES) * vh]);
    }
  }
  return pts;
}

/**
 * [tool_3 extract] categorical_fragments_1* + masks_2* -> fragment_contours_1*
 * The contour of a mask covers its original fragment and all its categorical variants.
 */
export async function extractContours(fragments: Fragment[], variants: EncodingVariant[]): Promise<Contour[]> {
  const out: Contour[] = [];
  for (const f of fragments) {
    const svgs = [f.svg, ...variants.filter((v) => v.maskId === f.maskId && v.versions.length).map((v) => v.versions[v.current])];
    let pts: [number, number][] = [];
    for (const s of svgs) {
      try { pts = pts.concat(await opaquePoints(s)); } catch { /* skip unrenderable variant */ }
    }
    const hull = pts.length ? convexHull(pts) : [];
    const bbox: BBox = hull.length
      ? (() => {
          const xs = hull.map((p) => p[0]), ys = hull.map((p) => p[1]);
          const x = Math.min(...xs), y = Math.min(...ys);
          return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
        })()
      : f.edge;
    out.push({ maskId: f.maskId, bbox, hull, anchor: [bbox.x + bbox.w / 2, bbox.y + bbox.h / 2] });
  }
  return out;
}
