// tool_1 translate: masks → vector shapes (segments) with texture.
import { contours } from 'd3-contour';
import simplify from 'simplify-js';
import type { Box, Element, MaskQuality } from '../../shared/types.js';
import { filePath, uid } from '../store.js';
import { cropMask, cutout, maskBox, padBox, removeSmall, saveMask, saveRGBA, type Mask, type RGBA } from './raster.js';

/** Trace a mask into SVG path data (evenodd), simplified with `tolerance` px. */
export function maskToPath(mask: Mask, w: number, h: number, tolerance = 0.8): string {
  // pad by one pixel so contours close at the border
  const pw = w + 2;
  const ph = h + 2;
  const values = new Float64Array(pw * ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values[(y + 1) * pw + x + 1] = mask[y * w + x];
  const [mp] = contours().size([pw, ph]).thresholds([0.5])(Array.from(values));
  const parts: string[] = [];
  for (const polygon of mp.coordinates) {
    for (const ring of polygon) {
      const pts = simplify(
        ring.map(([x, y]) => ({ x: x - 1, y: y - 1 })),
        tolerance,
        true,
      );
      if (pts.length < 3) continue;
      parts.push('M' + pts.map((p) => `${round(p.x)},${round(p.y)}`).join('L') + 'Z');
    }
  }
  return parts.join('');
}
const round = (n: number) => Math.round(n * 10) / 10;

export interface ElementInit {
  name: string;
  layerId: string;
  origin: Element['origin'];
  quality?: MaskQuality;
  color?: string;
}

/**
 * Convert a full-image mask + the image it was cut from into a saved Element.
 * The element is placed where it was in the image (center at bbox center).
 */
export async function maskToElement(
  projectId: string,
  img: RGBA,
  mask: Mask,
  init: ElementInit,
): Promise<Element | null> {
  const { width: w, height: h } = img;
  const cleaned = removeSmall(mask, w, h, 12);
  const b = maskBox(cleaned, w, h);
  if (!b) return null;
  const box: Box = padBox(b, 2, w, h);
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const local = cropMask(cleaned, w, box, h);
  const tex = cutout(img, cleaned, box);
  const id = uid('e_');
  const maskFile = `${id}_mask.png`;
  const texFile = `${id}_tex.png`;
  await saveMask(local, bw, bh, filePath(projectId, maskFile));
  await saveRGBA(tex, filePath(projectId, texFile));
  return {
    id,
    name: init.name,
    layerId: init.layerId,
    origin: init.origin,
    width: bw,
    height: bh,
    path: maskToPath(local, bw, bh),
    mask: maskFile,
    texture: texFile,
    x: box[0] + bw / 2,
    y: box[1] + bh / 2,
    scale: 1,
    rotation: 0,
    sourceBox: box,
    quality: init.quality,
    color: init.color,
  };
}

/** Replace an element's geometry/texture from a local mask + texture (keeps placement). */
export async function updateElementGeometry(projectId: string, el: Element, local: Mask, tex: RGBA): Promise<Element> {
  const stamp = uid('v');
  const maskFile = `${el.id}_${stamp}_mask.png`;
  const texFile = `${el.id}_${stamp}_tex.png`;
  await saveMask(local, tex.width, tex.height, filePath(projectId, maskFile));
  await saveRGBA(tex, filePath(projectId, texFile));
  // keep the visual centre: if size changed, centre stays at (x, y)
  return {
    ...el,
    width: tex.width,
    height: tex.height,
    mask: maskFile,
    texture: texFile,
    path: maskToPath(local, tex.width, tex.height),
  };
}
