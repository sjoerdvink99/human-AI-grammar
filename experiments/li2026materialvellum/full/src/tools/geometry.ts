import type { Vec } from '../urban/types';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
  return [a[0] + t * dx, a[1] + t * dy];
}

export function closestOnPolygon(p: Vec, poly: Vec[]): Vec {
  let best: Vec = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

export function polygonArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Resample a freehand closed stroke to n evenly spaced points. */
export function resampleClosed(points: Vec[], n: number): Vec[] {
  const pts = [...points, points[0]];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); seg.push(d); total += d; }
  if (total === 0) return points.slice(0, 1);
  const out: Vec[] = [];
  const step = total / n;
  let i = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (i < seg.length - 1 && acc + seg[i] < target) { acc += seg[i]; i++; }
    const t = seg[i] ? (target - acc) / seg[i] : 0;
    out.push([pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]);
  }
  return out;
}

let counter = 0;
export const uid = (p: string) => `${p}${++counter}`;
