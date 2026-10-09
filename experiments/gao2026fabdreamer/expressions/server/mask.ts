// tool_1 / tool_3 spatial helpers: binary masks (512×512 Uint8Array), morphology, components, tracing.
import { IMAGE_SIZE, type Segment, type StoredSegment } from '../shared/types.ts';

export const W = IMAGE_SIZE;
export const H = IMAGE_SIZE;
export type Mask = Uint8Array;

export const emptyMask = (): Mask => new Uint8Array(W * H);
export const area = (m: Mask) => m.reduce((a, v) => a + v, 0);

export function bbox(m: Mask): { x: number; y: number; w: number; h: number } | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (m[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const union = (a: Mask, b: Mask): Mask => a.map((v, i) => (v | b[i]) as number) as Mask;
export const intersect = (a: Mask, b: Mask): Mask => a.map((v, i) => (v & b[i]) as number) as Mask;
export const subtract = (a: Mask, b: Mask): Mask => a.map((v, i) => (v && !b[i] ? 1 : 0)) as Mask;

/** Even-odd scanline fill of polygons given in pixel coordinates. */
export function polygonsToMask(polys: [number, number][][]): Mask {
  const m = emptyMask();
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) m[y * W + x] ^= 1;
    }
  }
  return m;
}

/** 4-connected components. Returns labels (0 = background) and sizes indexed by label. */
export function components(m: Mask): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(W * H);
  const sizes = [0];
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || labels[i]) continue;
    next++;
    let size = 0;
    labels[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % W, y = (p / W) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && m[q] && !labels[q]) (labels[q] = next), stack.push(q);
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Chamfer (1, √2) distance from every pixel to the nearest pixel where target(m[i]) is true. */
function distanceTo(m: Mask, target: 0 | 1): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = m[i] === target ? 0 : INF;
  const D = Math.SQRT2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + D);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + D);
      }
      d[i] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + D);
        if (x > 0) v = Math.min(v, d[i + W - 1] + D);
      }
      d[i] = v;
    }
  return d;
}

export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return m.slice();
  const d = distanceTo(m, 1);
  return d.map((v) => (v <= r ? 1 : 0)) as unknown as Mask;
}
export function erode(m: Mask, r: number): Mask {
  if (r <= 0) return m.slice();
  const d = distanceTo(m, 0);
  const out = emptyMask();
  for (let i = 0; i < out.length; i++) out[i] = d[i] > r ? 1 : 0;
  return out;
}
export const open = (m: Mask, r: number) => dilate(erode(m, r), r);

/** Shift a full mask by integer offsets (pixels falling outside are dropped). */
export function shift(m: Mask, dx: number, dy: number): Mask {
  const out = emptyMask();
  dx = Math.round(dx);
  dy = Math.round(dy);
  for (let y = 0; y < H; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < W; x++) {
      const tx = x + dx;
      if (tx >= 0 && tx < W && m[y * W + x]) out[ty * W + tx] = 1;
    }
  }
  return out;
}

/** Scale a mask about a centre point (nearest neighbour). */
export function scaleMask(m: Mask, s: number, cx: number, cy: number): Mask {
  const out = emptyMask();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.round((x - cx) / s + cx), sy = Math.round((y - cy) / s + cy);
      if (sx >= 0 && sx < W && sy >= 0 && sy < H && m[sy * W + sx]) out[y * W + x] = 1;
    }
  return out;
}

// ---------- encoding ----------

export function encodeMask(m: Mask): { bbox: { x: number; y: number; w: number; h: number }; mask: string } | null {
  const b = bbox(m);
  if (!b) return null;
  const crop = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) crop[y * b.w + x] = m[(b.y + y) * W + b.x + x];
  return { bbox: b, mask: Buffer.from(crop).toString('base64') };
}

/** Decode a stored segment's mask into a full 512×512 mask (offset not applied). */
export function decodeMask(s: Pick<StoredSegment, 'bbox' | 'mask'>): Mask {
  const crop = Buffer.from(s.mask, 'base64');
  const m = emptyMask();
  const b = s.bbox;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (crop[y * b.w + x]) m[(b.y + y) * W + b.x + x] = 1;
  return m;
}

/** The segment's mask as placed on the canvas (offset applied). */
export const placedMask = (s: StoredSegment) => (s.dx || s.dy ? shift(decodeMask(s), s.dx, s.dy) : decodeMask(s));

// ---------- tracing (tool_1 translate: mask → vector path) ----------

type Pt = [number, number];

/** Trace pixel boundaries into closed loops (interior on the right, screen coords), simplified. */
export function traceMask(m: Mask, tolerance = 0.9): string {
  const VW = W + 1;
  // directed edges keyed by start vertex
  const out = new Map<number, number[]>();
  const edges: [number, number][] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const a = ay * VW + ax, b = by * VW + bx;
    edges.push([a, b]);
    const list = out.get(a);
    if (list) list.push(edges.length - 1);
    else out.set(a, [edges.length - 1]);
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  const used = new Uint8Array(edges.length);
  const vxy = (v: number): Pt => [v % VW, Math.floor(v / VW)];
  const loops: Pt[][] = [];
  for (let e0 = 0; e0 < edges.length; e0++) {
    if (used[e0]) continue;
    const loop: Pt[] = [];
    let e = e0;
    while (!used[e]) {
      used[e] = 1;
      const [a, b] = edges[e];
      loop.push(vxy(a));
      const cands = (out.get(b) ?? []).filter((k) => !used[k]);
      if (!cands.length) break;
      if (cands.length === 1) e = cands[0];
      else {
        // prefer right turn for consistent handling of diagonal touches
        const [ax, ay] = vxy(a), [bx, by] = vxy(b);
        const dx = bx - ax, dy = by - ay;
        e = cands.sort((p, q) => turn(p) - turn(q))[0];
        function turn(k: number) {
          const [cx, cy] = vxy(edges[k][1]);
          const ex = cx - bx, ey = cy - by;
          return -(dx * ey - dy * ex); // right turn (cross>0 in screen coords) first
        }
      }
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops
    .map((l) => simplifyClosed(l, tolerance))
    .filter((l) => l.length >= 3)
    .map((l) => 'M' + l.map(([x, y]) => `${round(x)} ${round(y)}`).join('L') + 'Z')
    .join('');
}
const round = (v: number) => Math.round(v * 10) / 10;

function simplifyClosed(pts: Pt[], tol: number): Pt[] {
  // drop collinear
  const c: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length], q = pts[i], r = pts[(i + 1) % pts.length];
    if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) !== 0) c.push(q);
  }
  if (c.length < 8) return c;
  // split at two far-apart points and run Douglas–Peucker on both halves
  const half = Math.floor(c.length / 2);
  const a = dp(c.slice(0, half + 1), tol);
  const b = dp([...c.slice(half), c[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > best) (best = d), (bi = i);
  }
  if (best <= tol) return [pts[0], pts[pts.length - 1]];
  const l = dp(pts.slice(0, bi + 1), tol);
  const r = dp(pts.slice(bi), tol);
  return [...l.slice(0, -1), ...r];
}

/** tool_1 translate: mask → stored segment */
export function maskToSegment(
  m: Mask,
  base: Omit<Segment, 'bbox' | 'path' | 'area' | 'dx' | 'dy'> & { dx?: number; dy?: number },
): StoredSegment | null {
  const enc = encodeMask(m);
  if (!enc) return null;
  return { ...base, dx: base.dx ?? 0, dy: base.dy ?? 0, bbox: enc.bbox, mask: enc.mask, path: traceMask(m), area: area(m) };
}

/** Recompute geometry for a segment after its mask changed. */
export function withMask(s: StoredSegment, m: Mask): StoredSegment | null {
  const enc = encodeMask(m);
  if (!enc) return null;
  return { ...s, bbox: enc.bbox, mask: enc.mask, path: traceMask(m), area: area(m) };
}

export const stripMask = ({ mask: _m, ...rest }: StoredSegment): Segment => rest;
