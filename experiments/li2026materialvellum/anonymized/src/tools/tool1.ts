// tool_1 — stroke beautifier. Implements every `[tool_1 modify]` in the design:
//   P1.2  r2_1 → r2_2   footprints on the ground plan
//   P1.11 r8_1 → r8_2   edit lassos on the generated image
//   P2.2  r12_1 → r12_2 sketch strokes
// Deterministic: simplification (Ramer–Douglas–Peucker), shape recognition, Chaikin smoothing.

import type { BBox, Point, Shape, ShapeKind, Stroke } from "../shared/types";

export interface BeautifyOptions {
  /** Treat every stroke as a closed region (lassos, footprints). */
  forceClosed?: boolean;
  /** Snap vertices of recognised polygons to this grid (canvas units). */
  snap?: number;
  /** Only allow these kinds; others fall back to polygon/freeform. */
  allow?: ShapeKind[];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function bboxOf(pts: Point[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pathLength(pts: Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function perpDist(p: Point, a: Point, b: Point): number {
  const l = dist(a, b);
  if (l === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
}

export function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

export function chaikin(pts: Point[], closed: boolean, iterations = 2): Point[] {
  let out = pts;
  for (let k = 0; k < iterations; k++) {
    const next: Point[] = [];
    const n = out.length;
    if (n < 3) return out;
    const limit = closed ? n : n - 1;
    if (!closed) next.push(out[0]);
    for (let i = 0; i < limit; i++) {
      const a = out[i], b = out[(i + 1) % n];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    if (!closed) next.push(out[n - 1]);
    out = next;
  }
  return out;
}

function ellipseError(pts: Point[], bb: BBox): number {
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  const rx = Math.max(bb.w / 2, 1), ry = Math.max(bb.h / 2, 1);
  let err = 0;
  for (const p of pts) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    err += Math.abs(r - 1);
  }
  return err / pts.length;
}

function ellipsePoints(bb: BBox, n = 48): Point[] {
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: cx + (bb.w / 2) * Math.cos(t), y: cy + (bb.h / 2) * Math.sin(t) };
  });
}

function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const snapPt = (p: Point, s?: number) => (s ? { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s } : p);

/** Beautify one stroke into a clean shape. */
export function beautifyStroke(stroke: Stroke, opts: BeautifyOptions = {}): Shape {
  const raw = stroke.points.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 0.5);
  const bb = bboxOf(raw);
  const size = Math.max(bb.w, bb.h, 1);
  const len = pathLength(raw);
  const closed = opts.forceClosed || (raw.length > 4 && dist(raw[0], raw[raw.length - 1]) < Math.max(18, size * 0.2));
  const allow = (k: ShapeKind) => !opts.allow || opts.allow.includes(k);

  let kind: ShapeKind;
  let points: Point[];

  if (!closed) {
    const simple = rdp(raw, Math.max(3, len * 0.04));
    if (simple.length <= 2 && allow("line")) {
      kind = "line";
      points = [snapPt(raw[0], opts.snap), snapPt(raw[raw.length - 1], opts.snap)];
    } else {
      kind = "freeform";
      points = chaikin(rdp(raw, 1.5), false, 2);
    }
  } else {
    const loop = raw.slice();
    const simple = rdp(loop.concat([loop[0]]), Math.max(4, len * 0.035)).slice(0, -1);
    const ellErr = ellipseError(raw, bb);
    const isRectLike =
      simple.length === 4 && simple.every((p, i) => {
        const a = angleAt(simple[(i + 3) % 4], p, simple[(i + 1) % 4]);
        return a > 65 && a < 115;
      });
    if (simple.length >= 5 && ellErr < 0.12 && allow("ellipse")) {
      kind = "ellipse";
      points = ellipsePoints(bb);
    } else if (simple.length === 3 && allow("triangle")) {
      kind = "triangle";
      points = simple.map((p) => snapPt(p, opts.snap));
    } else if (isRectLike && allow("rectangle")) {
      kind = "rectangle";
      const r = bboxOf(simple);
      const a = snapPt({ x: r.x, y: r.y }, opts.snap), b = snapPt({ x: r.x + r.w, y: r.y + r.h }, opts.snap);
      points = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    } else if (simple.length >= 3 && simple.length <= 8 && allow("polygon")) {
      kind = "polygon";
      points = simple.map((p) => snapPt(p, opts.snap));
    } else {
      kind = "freeform";
      points = chaikin(rdp(raw, 2), true, 2);
    }
  }

  return {
    id: stroke.id,
    kind,
    points,
    closed,
    color: stroke.color,
    width: stroke.width,
    bbox: bboxOf(points),
    intent: stroke.intent,
    recolorTo: stroke.recolorTo,
  };
}

/** `[tool_1 modify]`: (strokes_1)* → (strokes_2)* */
export function beautifyStrokes(strokes: Stroke[], opts: BeautifyOptions = {}): Shape[] {
  return strokes.filter((s) => s.points.length >= 2).map((s) => beautifyStroke(s, opts));
}
