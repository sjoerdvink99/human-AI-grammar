// tool_1 — physics engine. A small deterministic position-based solver used by
// the elastic zoning bands, the function magnets, and the ikebana magnets.
import type { Vec, ZoningBand, Magnet, UrbanFunction } from '../urban/types';
import type { IkebanaElement } from '../ikebana/types';
import { clamp, closestOnPolygon, dist, pointInPolygon, polygonArea } from './geometry';

// ---------------------------------------------------------------- bands
export interface BandPin { bandId: string; index: number; pos: Vec }

/**
 * zoning_bands_1 -> [tool_1 modify] -> zoning_bands_2
 * Elastic relaxation: edge springs toward an even rest length, light
 * smoothing, site bounds, and mutual exclusion between bands. Pinned
 * vertices (fingers holding the band) stay put; their neighbours follow.
 */
export function relaxBands(bands: ZoningBand[], size: number, pins: BandPin[] = [], iterations = 12): ZoningBand[] {
  const margin = 4;
  const out = bands.map((b) => ({ ...b, points: b.points.map((p) => [...p] as Vec) }));
  const pinned = (bid: string, i: number) => pins.find((p) => p.bandId === bid && p.index === i);
  for (let it = 0; it < iterations; it++) {
    for (const b of out) {
      const n = b.points.length;
      if (n < 3) continue;
      let per = 0;
      for (let i = 0; i < n; i++) per += dist(b.points[i], b.points[(i + 1) % n]);
      const rest = per / n;
      const next = b.points.map((p) => [...p] as Vec);
      for (let i = 0; i < n; i++) {
        const prev = b.points[(i - 1 + n) % n];
        const cur = b.points[i];
        const nxt = b.points[(i + 1) % n];
        // springs to neighbours
        let fx = 0, fy = 0;
        for (const q of [prev, nxt]) {
          const d = dist(cur, q) || 1e-6;
          const k = 0.25 * (d - rest) / d;
          fx += (q[0] - cur[0]) * k;
          fy += (q[1] - cur[1]) * k;
        }
        // smoothing (band tension)
        fx += 0.08 * ((prev[0] + nxt[0]) / 2 - cur[0]);
        fy += 0.08 * ((prev[1] + nxt[1]) / 2 - cur[1]);
        next[i] = [cur[0] + fx, cur[1] + fy];
      }
      for (let i = 0; i < n; i++) {
        const pin = pinned(b.id, i);
        if (pin) next[i] = [...pin.pos];
        next[i] = [clamp(next[i][0], margin, size - margin), clamp(next[i][1], margin, size - margin)];
      }
      b.points = next;
    }
    // bands may not overlap: vertices inside another band are pushed to its edge
    for (const a of out) {
      for (const b of out) {
        if (a === b || b.points.length < 3) continue;
        a.points = a.points.map((p, i) => {
          if (pinned(a.id, i) || !pointInPolygon(p, b.points)) return p;
          const q = closestOnPolygon(p, b.points);
          const dx = q[0] - p[0], dy = q[1] - p[1];
          const d = Math.hypot(dx, dy) || 1;
          return [q[0] + (dx / d) * 2, q[1] + (dy / d) * 2];
        });
      }
    }
  }
  // degenerate loops collapse: drop bands with tiny area
  return out.filter((b) => Math.abs(polygonArea(b.points)) > 400);
}

// ---------------------------------------------------------------- magnets
/** Compatibility: +1 attract, -1 repel. Missing pairs are neutral. */
const COMPAT: Partial<Record<string, number>> = {
  'park|school': 1, 'library|school': 1, 'park|sports': 1, 'hospital|park': 0.6,
  'market|plaza': 1, 'library|plaza': 0.5, 'hospital|market': -0.7, 'hospital|sports': -0.8,
  'market|school': -0.6, 'hospital|school': -0.4, 'plaza|sports': -0.3,
};
export function compatibility(a: UrbanFunction, b: UrbanFunction): number {
  if (a === b) return -1; // same functions spread out
  return COMPAT[[a, b].sort().join('|')] ?? 0;
}

/**
 * function_magnets_1 -> [tool_1 modify] -> function_magnets_2
 * Attraction toward a preferred distance for compatible functions, repulsion
 * for incompatible ones, hard minimum spacing, and canvas bounds.
 */
export function stepMagnets(magnets: Magnet[], size: number, pinnedIds: string[] = [], iterations = 6): Magnet[] {
  const out = magnets.map((m) => ({ ...m }));
  const minGap = 46;
  const margin = 22;
  for (let it = 0; it < iterations; it++) {
    const force = out.map(() => [0, 0] as Vec);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-3) { dx = 1; dy = 0; d = 1; }
        const ux = dx / d, uy = dy / d;
        const c = compatibility(a.fn, b.fn);
        let f = 0;
        if (c > 0 && d < 260) f = 0.06 * c * (d - 80); // pull toward 80px
        if (c < 0 && d < 220) f = -0.12 * -c * (220 - d); // push away
        if (d < minGap) f -= 0.5 * (minGap - d);
        force[i][0] += ux * f; force[i][1] += uy * f;
        force[j][0] -= ux * f; force[j][1] -= uy * f;
      }
    }
    out.forEach((m, i) => {
      if (pinnedIds.includes(m.id)) return;
      const fx = clamp(force[i][0], -8, 8), fy = clamp(force[i][1], -8, 8);
      m.x = clamp(m.x + fx, margin, size - margin);
      m.y = clamp(m.y + fy, margin, size - margin);
    });
    // hard constraint: magnets never overlap
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-3;
      if (d >= minGap) continue;
      const pa = pinnedIds.includes(a.id), pb = pinnedIds.includes(b.id);
      if (pa && pb) continue;
      const push = minGap - d;
      const wa = pa ? 0 : pb ? 1 : 0.5, wb = 1 - wa;
      const ux = d > 1e-2 ? dx / d : 1, uy = d > 1e-2 ? dy / d : 0;
      a.x = clamp(a.x - ux * push * wa, margin, size - margin); a.y = clamp(a.y - uy * push * wa, margin, size - margin);
      b.x = clamp(b.x + ux * push * wb, margin, size - margin); b.y = clamp(b.y + uy * push * wb, margin, size - margin);
    }
  }
  return out;
}

// ---------------------------------------------------------------- ikebana
export const IKEBANA_RATIO = { shin: 1, soe: 0.75, hikae: 0.5625 } as const;
const ANGLE_RANGE: Record<'shin' | 'soe' | 'hikae', [number, number]> = {
  shin: [0, 25], // degrees from vertical (absolute)
  soe: [35, 60],
  hikae: [60, 85],
};

/**
 * ikebana_elements_1 -> [tool_1 modify] -> ikebana_elements_2
 * The three main stems keep the classical 1 : 3/4 : 9/16 length proportion
 * and stay within their angle ranges; hikae leans opposite soe. Dragging a
 * main element rescales the whole arrangement. Flowers and leaves are drawn
 * toward the nearest main stem, repel each other, and stay shorter than it.
 */
export function enforceIkebana(
  els: IkebanaElement[], origin: Vec, size: number, dragged?: { id: string; pos: Vec },
): IkebanaElement[] {
  const out = els.map((e) => ({ ...e }));
  const mains = ['shin', 'soe', 'hikae'] as const;
  const polar = (e: IkebanaElement) => {
    const dx = e.x - origin[0], dy = origin[1] - e.y;
    return { len: Math.hypot(dx, dy), ang: (Math.atan2(dx, dy) * 180) / Math.PI };
  };
  const place = (e: IkebanaElement, len: number, ang: number) => {
    const r = (ang * Math.PI) / 180;
    e.x = origin[0] + Math.sin(r) * len;
    e.y = origin[1] - Math.cos(r) * len;
  };

  if (dragged) {
    const e = out.find((x) => x.id === dragged.id);
    if (e) { e.x = dragged.pos[0]; e.y = dragged.pos[1]; }
  }
  // scale from the dragged main (or shin)
  const lead = out.find((e) => e.id === dragged?.id && (mains as readonly string[]).includes(e.kind))
    ?? out.find((e) => e.kind === 'shin');
  if (!lead) return out;
  const maxShin = Math.min(origin[1] - 20, size * 0.78);
  let shinLen = polar(lead).len / IKEBANA_RATIO[lead.kind as 'shin'];
  shinLen = clamp(shinLen, 120, maxShin);

  // soe side decides hikae side
  const soe = out.find((e) => e.kind === 'soe');
  const soeSide = soe && polar(soe).ang < 0 ? -1 : 1;
  for (const kind of mains) {
    const e = out.find((x) => x.kind === kind);
    if (!e) continue;
    const { ang } = polar(e);
    const [lo, hi] = ANGLE_RANGE[kind];
    let side = Math.sign(ang) || 1;
    if (kind === 'hikae') side = -soeSide;
    if (kind === 'shin') side = Math.sign(ang) || 1;
    const a = side * clamp(Math.abs(ang), lo, hi);
    place(e, shinLen * IKEBANA_RATIO[kind], a);
  }

  // fillers
  const mainEls = out.filter((e) => (mains as readonly string[]).includes(e.kind));
  const fillers = out.filter((e) => e.kind === 'flower' || e.kind === 'leaf');
  for (let it = 0; it < 8; it++) {
    for (const f of fillers) {
      if (f.id === dragged?.id) continue;
      const fp = polar(f);
      // nearest main by angle
      let near = mainEls[0];
      let best = Infinity;
      for (const m of mainEls) { const d = Math.abs(polar(m).ang - fp.ang); if (d < best) { best = d; near = m; } }
      const mp = polar(near);
      // pull angle toward the main stem (within ±18°), stay shorter than it
      // attracted toward the stem, and kept within ±22° of it
      const pulled = fp.ang + (mp.ang - fp.ang) * 0.12;
      const ang = mp.ang + clamp(pulled - mp.ang, -22, 22);
      const len = clamp(fp.len, 40, mp.len * 0.85);
      place(f, len, clamp(ang, -88, 88));
    }
    // repulsion among all circles
    for (const a of out) for (const b of out) {
      if (a === b || a.id === dragged?.id) continue;
      if ((mains as readonly string[]).includes(a.kind)) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const min = a.r + b.r + 4;
      if (d < min) { a.x += ((a.x - b.x) / d) * (min - d) * 0.5; a.y += ((a.y - b.y) / d) * (min - d) * 0.5; }
    }
  }
  for (const e of out) {
    e.x = clamp(e.x, e.r, size - e.r);
    e.y = clamp(e.y, e.r, origin[1] - 10);
  }
  return out;
}
