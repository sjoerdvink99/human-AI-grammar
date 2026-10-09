// Sand simulation for the poster probe and cluster detection (tool_3 preprocessing).
import { clamp } from './geometry';

export const POSTER_SIZE = 512;
export const SAND_RES = 64; // cells per side
export const SAND_CELL = POSTER_SIZE / SAND_RES;
export const SAND_THRESHOLD = 0.08;

export type SandGrid = Float32Array; // SAND_RES² densities 0..1

export const emptySand = (): SandGrid => new Float32Array(SAND_RES * SAND_RES);

export type SandTool = 'pour' | 'push' | 'erase';

/** Brush on the sand: pour adds grains, erase removes, push moves sand along the drag. */
export function brushSand(g: SandGrid, x: number, y: number, dx: number, dy: number, tool: SandTool, radiusPx: number): SandGrid {
  const out = new Float32Array(g);
  const cx = x / SAND_CELL, cy = y / SAND_CELL, r = radiusPx / SAND_CELL;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(SAND_RES - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(SAND_RES - 1, Math.ceil(cy + r));
  const sx = Math.round(dx / SAND_CELL), sy = Math.round(dy / SAND_CELL);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
    if (d > r) continue;
    const w = 1 - d / r;
    const k = j * SAND_RES + i;
    if (tool === 'pour') out[k] = clamp(out[k] + 0.12 * w, 0, 1);
    else if (tool === 'erase') out[k] = clamp(out[k] - 0.25 * w, 0, 1);
    else if (sx || sy) {
      const ti = clamp(i + sx, 0, SAND_RES - 1), tj = clamp(j + sy, 0, SAND_RES - 1);
      const moved = g[k] * 0.6 * w;
      out[k] -= moved;
      out[tj * SAND_RES + ti] = clamp(out[tj * SAND_RES + ti] + moved, 0, 1);
    }
  }
  return out;
}

/** sand_clusters: connected regions of sand. size/density set element size/weight. */
export interface SandCluster {
  id: string;
  cells: number[];
  bbox: { x: number; y: number; w: number; h: number }; // px
  size: number; // fraction of the canvas covered by the bbox
  density: number; // mean grain density 0..1
  centroid: [number, number];
}

/**
 * Detect clusters (8-connected). IDs are kept stable across reshaping by
 * matching to the previous clusters with the largest cell overlap.
 */
export function detectClusters(g: SandGrid, prev: SandCluster[] = []): SandCluster[] {
  const seen = new Uint8Array(g.length);
  const found: Omit<SandCluster, 'id'>[] = [];
  for (let s = 0; s < g.length; s++) {
    if (seen[s] || g[s] < SAND_THRESHOLD) continue;
    const cells: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      cells.push(k);
      const i = k % SAND_RES, j = Math.floor(k / SAND_RES);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= SAND_RES || jj >= SAND_RES) continue;
        const kk = jj * SAND_RES + ii;
        if (!seen[kk] && g[kk] >= SAND_THRESHOLD) { seen[kk] = 1; stack.push(kk); }
      }
    }
    if (cells.length < 6) continue;
    let minI = SAND_RES, minJ = SAND_RES, maxI = 0, maxJ = 0, sum = 0, mx = 0, my = 0;
    for (const k of cells) {
      const i = k % SAND_RES, j = Math.floor(k / SAND_RES);
      minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
      sum += g[k]; mx += i; my += j;
    }
    const bbox = { x: minI * SAND_CELL, y: minJ * SAND_CELL, w: (maxI - minI + 1) * SAND_CELL, h: (maxJ - minJ + 1) * SAND_CELL };
    found.push({
      cells, bbox,
      size: (bbox.w * bbox.h) / (POSTER_SIZE * POSTER_SIZE),
      density: Math.min(1, sum / cells.length),
      centroid: [((mx / cells.length) + 0.5) * SAND_CELL, ((my / cells.length) + 0.5) * SAND_CELL],
    });
  }
  const used = new Set<string>();
  let next = Math.max(0, ...prev.map((p) => Number(p.id.slice(1)) || 0)) + 1;
  return found.map((c) => {
    const cs = new Set(c.cells);
    let best: SandCluster | undefined;
    let bestOverlap = 0;
    for (const p of prev) {
      if (used.has(p.id)) continue;
      const o = p.cells.reduce((a, k) => a + (cs.has(k) ? 1 : 0), 0);
      if (o > bestOverlap) { bestOverlap = o; best = p; }
    }
    const id = best ? best.id : `c${next++}`;
    used.add(id);
    return { ...c, id };
  });
}
