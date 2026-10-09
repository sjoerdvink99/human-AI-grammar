// tool_3 — urban preprocessing and postprocessing.
import {
  CELL, DENSITY_RES, N_BLOCKS, RENDER_SIZE, SITE, STREET,
  type DensityGrid, type Magnet, type UrbanFunction, type UrbanPlan, type Zone, type ZoningBand,
} from '../urban/types';
import type { InpaintMask } from '../shared/api';
import { pointInPolygon } from './geometry';

/** zoning_bands_2 -> [tool_3 compose] -> urban_plan_1 (later bands win). */
export function composePlan(bands: ZoningBand[]): UrbanPlan {
  const blocks: UrbanPlan['blocks'] = [];
  for (let j = 0; j < N_BLOCKS; j++) {
    for (let i = 0; i < N_BLOCKS; i++) {
      const c: [number, number] = [(i + 0.5) * CELL, (j + 0.5) * CELL];
      let zone: Zone | 'none' = 'none';
      for (const b of bands) if (pointInPolygon(c, b.points)) zone = b.zone;
      blocks.push({ i, j, zone });
    }
  }
  return { blocks };
}

export const ZONE_DEFAULT_DENSITY: Record<Zone | 'none', number> = {
  residential: 0.3, commercial: 0.75, mixed: 0.5, industrial: 0.25, park: 0, none: 0,
};

/** city_model_1 -> [tool_3 translate] -> density_grid_1 (seeded from the zones in the model). */
export function initDensity(plan: UrbanPlan): DensityGrid {
  const k = DENSITY_RES / N_BLOCKS;
  const g: DensityGrid = Array.from({ length: DENSITY_RES }, () => Array(DENSITY_RES).fill(0));
  for (const b of plan.blocks) {
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) g[b.j * k + dy][b.i * k + dx] = ZONE_DEFAULT_DENSITY[b.zone];
  }
  return g;
}

/** Human clay gesture on density_grid: raise, lower, or smooth with a soft brush. */
export type ClayMode = 'raise' | 'lower' | 'smooth';
export function sculpt(g: DensityGrid, cx: number, cy: number, radius: number, mode: ClayMode, strength = 0.08): DensityGrid {
  const out = g.map((r) => [...r]);
  const n = g.length;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > radius) continue;
    const w = Math.exp(-(d * d) / (radius * radius * 0.5));
    if (mode === 'raise') out[y][x] = Math.min(1, g[y][x] + strength * w);
    else if (mode === 'lower') out[y][x] = Math.max(0, g[y][x] - strength * w);
    else {
      let s = 0, c = 0;
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
        if (yy >= 0 && xx >= 0 && yy < n && xx < n) { s += g[yy][xx]; c++; }
      }
      out[y][x] = g[y][x] + (s / c - g[y][x]) * w * 0.6;
    }
  }
  return out;
}

/** Block-level density (mean of the block's clay cells). */
export function blockDensity(g: DensityGrid, i: number, j: number): number {
  const k = DENSITY_RES / N_BLOCKS;
  let s = 0;
  for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += g[j * k + dy][i * k + dx];
  return s / (k * k);
}

/** Downsample a grayscale depth image to an n×n grid of digits 0..9. */
export function depthImageToGrid(data: Uint8ClampedArray, w: number, h: number, n = 24): number[][] {
  const grid: number[][] = [];
  for (let gy = 0; gy < n; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < n; gx++) {
      let s = 0, c = 0;
      const x0 = Math.floor((gx * w) / n), x1 = Math.floor(((gx + 1) * w) / n);
      const y0 = Math.floor((gy * h) / n), y1 = Math.floor(((gy + 1) * h) / n);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += data[(y * w + x) * 4]; c++; }
      row.push(Math.min(9, Math.round(((s / Math.max(1, c)) / 255) * 9)));
    }
    grid.push(row);
  }
  return grid;
}

// ------------------------------------------------------------ inpainting
const FUNCTION_PROMPT: Record<UrbanFunction, string> = {
  park: 'a public park with lawns, clustered trees, winding footpaths and a small pond',
  school: 'a primary school: a low L-shaped building with a flat roof, a schoolyard and a running track',
  hospital: 'a hospital: a large white building with a red-cross helipad on the roof and an ambulance driveway',
  market: 'an open-air market: rows of colourful stall awnings and a busy loading lane',
  plaza: 'a paved public plaza with a fountain in the centre, benches and a few trees',
  library: 'a public library: a modern building with a green roof and a reading garden',
  sports: 'a sports ground: a football pitch with white line markings and a small stand',
};

/** Block rectangle (in render coordinates) for block (i, j). */
export function blockRect(i: number, j: number): InpaintMask & { i: number; j: number } {
  const s = RENDER_SIZE / SITE;
  return {
    id: `b${i}_${j}`, i, j,
    x: Math.round((i * CELL + STREET / 2) * s), y: Math.round((j * CELL + STREET / 2) * s),
    w: Math.round((CELL - STREET) * s), h: Math.round((CELL - STREET) * s),
  };
}

/**
 * function_magnets_2 -> [tool_3 translate] -> inpainting_masks_1 + function_prompts_1
 * Each magnet takes the nearest block that no other magnet has taken.
 */
export function magnetsToMasks(magnets: Magnet[]): { masks: InpaintMask[]; prompts: string[] } {
  const cellR = RENDER_SIZE / N_BLOCKS;
  const taken = new Set<string>();
  const masks: InpaintMask[] = [];
  const prompts: string[] = [];
  for (const m of magnets) {
    const cand: { i: number; j: number; d: number }[] = [];
    for (let j = 0; j < N_BLOCKS; j++) for (let i = 0; i < N_BLOCKS; i++) {
      cand.push({ i, j, d: Math.hypot((i + 0.5) * cellR - m.x, (j + 0.5) * cellR - m.y) });
    }
    cand.sort((a, b) => a.d - b.d);
    const c = cand.find((c) => !taken.has(`${c.i},${c.j}`))!;
    taken.add(`${c.i},${c.j}`);
    const r = blockRect(c.i, c.j);
    masks.push({ id: m.id, x: r.x, y: r.y, w: r.w, h: r.h });
    prompts.push(FUNCTION_PROMPT[m.fn]);
  }
  return { masks, prompts };
}

/** render_1 + patches -> render_2: patches clipped to their masks, drawn over render_1. */
export function compositeInpaint(render: string, masks: InpaintMask[], patches: { id: string; svg: string }[]): string {
  const defs = masks.map((m) => `<clipPath id="inpaint-${m.id}"><rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}"/></clipPath>`).join('');
  const layers = patches.map((p) => `<g clip-path="url(#inpaint-${p.id})">${p.svg}</g>`).join('');
  return render.replace(/<\/svg>\s*$/i, `<defs>${defs}</defs>${layers}</svg>`);
}
