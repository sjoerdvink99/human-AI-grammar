// tool_3 evaluate: geometric fabrication constraint detection (process 10).
// floating = a connected piece of a layer's cut sheet that is not attached to the layer's main piece;
// thin = material removed by a morphological opening with the material's minimum feature width.
import type { Box, ConstraintIssue, Workspace } from '../../shared/types.js';
import { components, openMask, type Mask } from './raster.js';
import { layerElements, mmPerPx, rasterElement } from './layerRender.js';

export interface LayerRaster {
  factor: number;
  W: number;
  H: number;
  union: Mask;
  perElement: { id: string; mask: Mask }[];
}

export async function rasterLayer(ws: Workspace, layerId: string, factor: number): Promise<LayerRaster> {
  const layer = ws.canvas!.layers.find((l) => l.id === layerId)!;
  const W = Math.round(ws.canvas!.width * factor);
  const H = Math.round(ws.canvas!.height * factor);
  const union = new Uint8Array(W * H);
  const perElement: { id: string; mask: Mask }[] = [];
  const parts: (Promise<{ id: string; mask: Mask }>)[] = layerElements(ws, layer).map(async (e) => ({ id: e.id, mask: await rasterElement(ws, e, layer, factor) }));
  if (layer.frame) parts.push(rasterElement(ws, 'frame', layer, factor).then((mask) => ({ id: 'frame', mask })));
  for (const r of await Promise.all(parts)) {
    perElement.push(r);
    for (let i = 0; i < union.length; i++) if (r.mask[i]) union[i] = 1;
  }
  return { factor, W, H, union, perElement };
}

export function analysisFactor(ws: Workspace) {
  const minPx = ws.material.minFeatureMm / mmPerPx(ws);
  return Math.max(1, Math.min(3, 4 / minPx));
}

export async function checkConstraints(ws: Workspace): Promise<ConstraintIssue[]> {
  if (!ws.canvas) return [];
  const mm = mmPerPx(ws);
  const factor = analysisFactor(ws);
  const mmPerCell = mm / factor;
  const issues: ConstraintIssue[] = [];
  let n = 0;
  for (const layer of ws.canvas.layers) {
    if (!layer.elementIds.length && !layer.frame) continue;
    const r = await rasterLayer(ws, layer.id, factor);
    const { W, H, union } = r;
    const toCanvas = (b: Box): Box => [b[0] / factor, b[1] / factor, b[2] / factor, b[3] / factor];
    const owners = (sel: (i: number) => boolean, box: Box) => {
      const ids = new Set<string>();
      for (const pe of r.perElement) {
        if (pe.id === 'frame') continue;
        for (let y = box[1]; y < box[3] && !ids.has(pe.id); y++)
          for (let x = box[0]; x < box[2]; x++) {
            const i = y * W + x;
            if (pe.mask[i] && sel(i)) {
              ids.add(pe.id);
              break;
            }
          }
      }
      return [...ids];
    };

    // floating components
    const { labels, comps } = components(union, W, H);
    if (comps.length > 1) {
      const main = comps.reduce((a, b) => (b.area > a.area ? b : a));
      const mainEdge = boundary(labels, W, H, main.label, 3000);
      for (const c of comps) {
        if (c.label === main.label) continue;
        const edge = boundary(labels, W, H, c.label, 400);
        let best = Infinity;
        let from: [number, number] = [c.cx, c.cy];
        let to: [number, number] = [main.cx, main.cy];
        for (const a of edge)
          for (const b of mainEdge) {
            const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
            if (d < best) {
              best = d;
              from = a;
              to = b;
            }
          }
        const ids = owners((i) => labels[i] === c.label, c.box);
        const names = ids.map((id) => ws.elements[id]?.name).join(', ');
        issues.push({
          id: `I${++n}`,
          type: 'floating',
          layerId: layer.id,
          elementIds: ids,
          box: toCanvas(c.box),
          areaMm2: c.area * mmPerCell * mmPerCell,
          from: [from[0] / factor, from[1] / factor],
          to: [to[0] / factor, to[1] / factor],
          detail: `Piece (${names || 'unnamed'}) on layer "${layer.name}" is not connected to the main piece; gap ${(Math.sqrt(best) * mmPerCell).toFixed(1)} mm. It would fall out when cut.`,
        });
      }
    }

    // thin features
    const rad = ws.material.minFeatureMm / mmPerCell / 2;
    const opened = openMask(union, W, H, rad);
    const thin = new Uint8Array(union.length);
    for (let i = 0; i < union.length; i++) thin[i] = union[i] && !opened[i] ? 1 : 0;
    const tc = components(thin, W, H);
    const minArea = Math.max(8, 1.5 * (2 * rad) ** 2);
    const thinComps = tc.comps.filter((c) => c.area >= minArea).sort((a, b) => b.area - a.area).slice(0, 12);
    for (const c of thinComps) {
      const ids = owners((i) => tc.labels[i] === c.label, c.box);
      const names = ids.map((id) => ws.elements[id]?.name).join(', ');
      issues.push({
        id: `I${++n}`,
        type: 'thin',
        layerId: layer.id,
        elementIds: ids,
        box: toCanvas(c.box),
        areaMm2: c.area * mmPerCell * mmPerCell,
        detail: `Feature in ${names || 'frame'} on layer "${layer.name}" is thinner than ${ws.material.minFeatureMm} mm (${ws.material.material}); it may burn away or break.`,
      });
    }
  }
  return issues;
}

/** Sample boundary pixels of a labelled component. */
function boundary(labels: Int32Array, W: number, H: number, label: number, max: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (labels[i] !== label) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || labels[i - 1] !== label || labels[i + 1] !== label || labels[i - W] !== label || labels[i + W] !== label)
        pts.push([x, y]);
    }
  if (pts.length <= max) return pts;
  const step = pts.length / max;
  return Array.from({ length: max }, (_, k) => pts[Math.floor(k * step)]);
}
