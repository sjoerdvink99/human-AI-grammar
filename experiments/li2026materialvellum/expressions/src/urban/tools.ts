/**
 * Deterministic tools of process 1.
 * tool_1 = sensing / clean-up of hand-placed tokens
 * tool_2 = city model engine
 * tool_3 = converter / compositor
 */
import { clamp, distToPolyline, hash01, polylineLength, simplify, smooth } from '../geom';
import type {
  Building, CellUse, CityModel, DensityGrid, DepthMap, FunctionMagnet, FunctionPrompt,
  InpaintMask, UrbanPlan, UrbanSite, Zone, ZoningBand, UrbanFunction,
} from './types';

export const SITE_SIZE = 512;
export const SITE_GRID = 32;
export const DENSITY_BLOCKS = 8;
export const MAX_HEIGHT_M = 120;
const ROAD_EVERY = 6;

/** The starting (urban_site_1): an empty site crossed by a river. */
export function createSite(): UrbanSite {
  const water: boolean[] = [];
  for (let r = 0; r < SITE_GRID; r++)
    for (let c = 0; c < SITE_GRID; c++) {
      const center = 6 + Math.round(3 * Math.sin(r / 5)) + Math.floor(r / 6);
      water.push(c >= center && c < center + 2);
    }
  return { size: SITE_SIZE, grid: SITE_GRID, water };
}

/** [tool_1 modify] zoning_bands_1 -> zoning_bands_2: simplify, smooth, clip, snap width, drop scribbles. */
export function tool1CleanBands(bands: ZoningBand[], site: UrbanSite): ZoningBand[] {
  const cell = site.size / site.grid;
  return bands
    .map((b) => {
      const clipped = b.points.map((p) => ({ x: clamp(p.x, 0, site.size), y: clamp(p.y, 0, site.size) }));
      const pts = smooth(simplify(clipped, cell * 0.6), 2);
      const width = Math.max(cell, Math.round(b.width / cell) * cell);
      return { ...b, points: pts, width };
    })
    .filter((b) => b.points.length >= 2 && polylineLength(b.points) >= cell);
}

/** [tool_3 compose] zoning_bands_2 -> urban_plan_1: rasterize bands onto the site grid and lay out a road grid. */
export function tool3ComposePlan(bands: ZoningBand[], site: UrbanSite): UrbanPlan {
  const { grid, size } = site;
  const cell = size / grid;
  const cells: CellUse[] = site.water.map((w) => (w ? 'water' : 'empty'));
  for (const b of bands) {
    for (let r = 0; r < grid; r++)
      for (let c = 0; c < grid; c++) {
        const i = r * grid + c;
        if (cells[i] === 'water') continue;
        const p = { x: (c + 0.5) * cell, y: (r + 0.5) * cell };
        if (distToPolyline(p, b.points) <= b.width / 2) cells[i] = b.zone;
      }
  }
  // road grid through developed (non-green) land
  for (let r = 0; r < grid; r++)
    for (let c = 0; c < grid; c++) {
      const i = r * grid + c;
      const u = cells[i];
      if ((r % ROAD_EVERY === 0 || c % ROAD_EVERY === 0) && u !== 'water' && u !== 'green' && u !== 'empty') cells[i] = 'road';
    }
  return { grid, size, cells };
}

const ZONE_BASE_HEIGHT: Record<Exclude<Zone, 'green'>, number> = {
  residential: 14, commercial: 32, office: 60, industrial: 12,
};

/** [tool_2 translate] urban_plan_1 -> city_model_1: procedural massing, one building per built cell. */
export function tool2PlanToCityModel(plan: UrbanPlan): CityModel {
  const buildings: Building[] = [];
  plan.cells.forEach((u, i) => {
    if (u === 'water' || u === 'road' || u === 'empty' || u === 'green') return;
    const row = Math.floor(i / plan.grid), col = i % plan.grid;
    const base = ZONE_BASE_HEIGHT[u];
    const h = base * (0.6 + 0.8 * hash01(row, col, 7));
    buildings.push({ id: `b${row}_${col}`, row, col, zone: u, height: Math.round(h), footprint: u === 'industrial' ? 0.95 : 0.78 });
  });
  return { plan, buildings };
}

function blockOf(row: number, col: number, grid: number, blocks: number) {
  const per = grid / blocks;
  return Math.floor(row / per) * blocks + Math.floor(col / per);
}

/** [tool_3 translate] city_model_1 -> density_grid_1: mean built height per block, normalized. */
export function tool3CityToDensity(model: CityModel, blocks = DENSITY_BLOCKS): DensityGrid {
  const per = (model.plan.grid / blocks) ** 2;
  const sum = new Array(blocks * blocks).fill(0);
  for (const b of model.buildings) sum[blockOf(b.row, b.col, model.plan.grid, blocks)] += b.height;
  return { blocks, values: sum.map((s) => clamp(s / per / (MAX_HEIGHT_M * 0.5), 0, 1)) };
}

/** [tool_2 modify] city_model_1 + density_grid_2 -> city_model_2: rescale building heights to the painted density. */
export function tool2ApplyDensity(model: CityModel, density: DensityGrid): CityModel {
  const { grid } = model.plan;
  const current = tool3CityToDensity(model, density.blocks);
  const buildings: Building[] = [];
  const byBlock = new Map<number, Building[]>();
  for (const b of model.buildings) {
    const k = blockOf(b.row, b.col, grid, density.blocks);
    byBlock.set(k, [...(byBlock.get(k) ?? []), b]);
  }
  for (let k = 0; k < density.values.length; k++) {
    const target = density.values[k];
    const cur = current.values[k];
    const list = byBlock.get(k) ?? [];
    if (target <= 0.01) continue; // block cleared
    if (cur > 0 && list.length) {
      const f = target / cur;
      for (const b of list) buildings.push({ ...b, height: Math.round(clamp(b.height * f, 3, MAX_HEIGHT_M)) });
    } else {
      // empty block painted with density: infill residential buildings on free, non-road land
      const per = grid / density.blocks;
      const br = Math.floor(k / density.blocks) * per, bc = (k % density.blocks) * per;
      const free: [number, number][] = [];
      for (let r = br; r < br + per; r++)
        for (let c = bc; c < bc + per; c++) {
          const u = model.plan.cells[r * grid + c];
          if (u === 'empty' || u === 'residential' || u === 'commercial' || u === 'office' || u === 'industrial') free.push([r, c]);
        }
      if (!free.length) continue;
      const h = (target * MAX_HEIGHT_M * 0.5 * per * per) / free.length;
      for (const [r, c] of free)
        buildings.push({ id: `b${r}_${c}`, row: r, col: c, zone: 'residential', footprint: 0.78, height: Math.round(clamp(h, 3, MAX_HEIGHT_M)) });
    }
  }
  return { plan: model.plan, buildings };
}

/** [tool_3 translate] city_model_2 -> depth_map_1: top-down height map (taller = brighter). */
export function tool3CityToDepthMap(model: CityModel): DepthMap {
  const { grid, size } = model.plan;
  const cellPx = size / grid;
  const levels = new Array(grid * grid).fill(0);
  for (const b of model.buildings) levels[b.row * grid + b.col] = clamp(Math.ceil((b.height / MAX_HEIGHT_M) * 9), 1, 9);
  let pngDataUrl = '';
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    for (const b of model.buildings) {
      const v = Math.round(40 + 215 * clamp(b.height / MAX_HEIGHT_M, 0, 1));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      const inset = ((1 - b.footprint) / 2) * cellPx;
      ctx.fillRect(b.col * cellPx + inset, b.row * cellPx + inset, cellPx - 2 * inset, cellPx - 2 * inset);
    }
    pngDataUrl = cv.toDataURL('image/png');
  }
  return { pngDataUrl, width: size, height: size, grid, levels, maxHeightM: MAX_HEIGHT_M };
}

/** [tool_1 modify] function_magnets_1 -> function_magnets_2: snap radius, keep inside the image, push overlaps apart. */
export function tool1SettleMagnets(magnets: FunctionMagnet[], size = SITE_SIZE): FunctionMagnet[] {
  const R: Record<UrbanFunction, number> = {
    park: 56, plaza: 36, school: 40, hospital: 44, market: 40, stadium: 60, museum: 40, waterfront: 52,
  };
  const out = magnets.map((m) => ({ ...m, r: R[m.fn] }));
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = (a.r + b.r) * 0.9;
        if (d < min) {
          const push = (min - d) / 2;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
    for (const m of out) { m.x = clamp(m.x, m.r, size - m.r); m.y = clamp(m.y, m.r, size - m.r); }
    if (!moved) break;
  }
  return out.map((m) => ({ ...m, x: Math.round(m.x), y: Math.round(m.y) }));
}

const FUNCTION_PROMPT: Record<UrbanFunction, string> = {
  park: 'a green public park seen from above: lawns, clusters of tree canopies, curving footpaths and a small pond',
  plaza: 'a paved public plaza seen from above with a central fountain, patterned paving, benches and small trees',
  school: 'a school campus seen from above: a low building with a courtyard, a sports field with track markings and a playground',
  hospital: 'a hospital complex seen from above: large white building with a rooftop helipad (H in a circle) and parking',
  market: 'an open-air market seen from above: rows of colourful stall canopies and crowded walkways',
  stadium: 'a stadium seen from above: oval roofed stands around a bright green pitch with field markings',
  museum: 'a museum seen from above: sculptural roof with skylights, a forecourt and a reflecting pool',
  waterfront: 'a waterfront promenade seen from above: boardwalk, piers, small boats and planted edges along the water',
};

/** [tool_3 translate] function_magnets_2 -> inpainting_masks_1 + function_prompts_1 */
export function tool3MagnetsToMasks(magnets: FunctionMagnet[]): { masks: InpaintMask[]; prompts: FunctionPrompt[] } {
  const masks = magnets.map((m) => ({ id: m.id, cx: m.x, cy: m.y, r: m.r }));
  const prompts = magnets.map((m) => ({ maskId: m.id, text: FUNCTION_PROMPT[m.fn] }));
  return { masks, prompts };
}
