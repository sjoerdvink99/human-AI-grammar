// Shared layer rendering for tool_1 (export) and tool_3 (constraint checks).
import fs from 'node:fs';
import type { CanvasLayer, Element, Workspace } from '../../shared/types.js';
import { filePath, uid } from '../store.js';
import { alphaToMask, rasterizeSvg, saveMask, saveRGBA, type Mask } from './raster.js';
import { maskToPath } from './vectorize.js';

export const mmPerPx = (ws: Workspace) => ws.material.sheetWidthMm / ws.canvas!.width;

export const elementTransform = (e: Element) =>
  `translate(${e.x.toFixed(2)} ${e.y.toFixed(2)}) rotate(${e.rotation.toFixed(2)}) scale(${e.scale.toFixed(4)}) translate(${(-e.width / 2).toFixed(2)} ${(-e.height / 2).toFixed(2)})`;

export function framePath(ws: Workspace, layer: CanvasLayer) {
  const { width: W, height: H } = ws.canvas!;
  const f = layer.frameWidthMm / mmPerPx(ws);
  return `M0,0H${W}V${H}H0Z M${f},${f}V${H - f}H${W - f}V${f}Z`;
}

export const layerElements = (ws: Workspace, layer: CanvasLayer) => layer.elementIds.map((id) => ws.elements[id]).filter(Boolean);

/** Rasterize one element's shape (or the frame) into canvas space at `factor` × canvas resolution. */
export async function rasterElement(ws: Workspace, e: Element | 'frame', layer: CanvasLayer, factor: number): Promise<Mask> {
  const W = Math.round(ws.canvas!.width * factor);
  const H = Math.round(ws.canvas!.height * factor);
  const body =
    e === 'frame'
      ? `<path d="${framePath(ws, layer)}" fill="#fff" fill-rule="evenodd"/>`
      : `<path d="${e.path}" transform="${elementTransform(e)}" fill="#fff" fill-rule="evenodd"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${ws.canvas!.width} ${ws.canvas!.height}">${body}</svg>`;
  return alphaToMask(await rasterizeSvg(svg, W, H));
}

/** Textured render of a layer as an SVG document using embedded textures (for PNG export). */
export function texturedLayerSvg(projectId: string, ws: Workspace, layer: CanvasLayer, pxWidth: number) {
  const { width: W, height: H } = ws.canvas!;
  const s = pxWidth / W;
  let body = '';
  if (layer.frame) body += `<path d="${framePath(ws, layer)}" fill="#d8cbb5" fill-rule="evenodd"/>`;
  for (const e of layerElements(ws, layer)) {
    const data = fs.readFileSync(filePath(projectId, e.texture)).toString('base64');
    body += `<g transform="${elementTransform(e)}"><image width="${e.width}" height="${e.height}" href="data:image/png;base64,${data}"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * s)}" height="${Math.round(H * s)}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

/** Create a solid-colour shape element (bridges) from a path given in canvas coordinates. */
export async function shapeElement(
  projectId: string,
  name: string,
  layerId: string,
  origin: Element['origin'],
  polygon: [number, number][],
  color: string,
): Promise<Element> {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)) - 1;
  const y0 = Math.floor(Math.min(...ys)) - 1;
  const w = Math.ceil(Math.max(...xs)) + 1 - x0;
  const h = Math.ceil(Math.max(...ys)) + 1 - y0;
  const d = 'M' + polygon.map(([x, y]) => `${(x - x0).toFixed(2)},${(y - y0).toFixed(2)}`).join('L') + 'Z';
  const img = await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="${color}"/></svg>`, w, h);
  const mask = alphaToMask(img);
  const id = uid('e_');
  await saveMask(mask, w, h, filePath(projectId, `${id}_mask.png`));
  await saveRGBA(img, filePath(projectId, `${id}_tex.png`));
  return {
    id,
    name,
    layerId,
    origin,
    width: w,
    height: h,
    path: maskToPath(mask, w, h, 0.3),
    mask: `${id}_mask.png`,
    texture: `${id}_tex.png`,
    x: x0 + w / 2,
    y: y0 + h / 2,
    scale: 1,
    rotation: 0,
    color,
  };
}
