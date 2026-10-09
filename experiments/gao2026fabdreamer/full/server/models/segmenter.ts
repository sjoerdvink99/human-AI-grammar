// model_3: image segmentation model (SAM2 in the design).
// Realized with the Claude CLI tracing a polygon outline inside a crop around the detection box.
// Swap `segment`/`refine` for a SAM2 endpoint to change providers; both return full-image masks.
import sharp from 'sharp';
import { callModel } from '../llm.js';
import type { Box, DetectionPrompt } from '../../shared/types.js';
import { padBox, polygonsToMask, snapToEdges, type Mask, type RGBA } from '../tools/raster.js';
import { uid } from '../store.js';
import path from 'node:path';

const SYSTEM =
  'You are the segmentation component (model_3) of a layered cut-art tool. Given an image crop and a target, ' +
  'you trace the precise outline of the target object as polygons in pixel coordinates of the crop. ' +
  'Follow the visible silhouette closely (use 20-80 vertices per polygon), exclude background. Answer only with JSON.';

const polySchema = {
  type: 'object',
  properties: {
    polygons: {
      type: 'array',
      items: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
    },
    confidence: { type: 'number' },
  },
  required: ['polygons', 'confidence'],
};

export interface MaskResult {
  prompt: DetectionPrompt;
  mask: Mask;
  confidence: number;
}

const CROP_SIDE = 512;

async function makeCrop(img: RGBA, box: Box, dir: string, overlay?: Mask) {
  const crop = padBox(box, Math.round(0.12 * Math.max(box[2] - box[0], box[3] - box[1])) + 6, img.width, img.height);
  const cw = crop[2] - crop[0];
  const ch = crop[3] - crop[1];
  const s = CROP_SIDE / Math.max(cw, ch);
  const outW = Math.max(1, Math.round(cw * s));
  const outH = Math.max(1, Math.round(ch * s));
  let pipeline = sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .extract({ left: crop[0], top: crop[1], width: cw, height: ch })
    .resize(outW, outH);
  const composites: import("sharp").OverlayOptions[] = [];
  // draw the target box so the model knows which instance is meant
  const bx = (box[0] - crop[0]) * s;
  const by = (box[1] - crop[1]) * s;
  const bw = (box[2] - box[0]) * s;
  const bh = (box[3] - box[1]) * s;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#00e5ff" stroke-width="2" stroke-dasharray="6 4"/>`;
  if (overlay) svg += overlayOutline(overlay, img.width, crop, s);
  svg += '</svg>';
  composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
  pipeline = pipeline.composite(composites);
  const file = path.join(dir, `tmp_seg_${uid()}.png`);
  await pipeline.png().toFile(file);
  return { file, crop, s, outW, outH };
}

/** Draw the previous mask as a semi-transparent red overlay (for refinement). */
function overlayOutline(mask: Mask, w: number, crop: Box, s: number) {
  const step = Math.max(1, Math.round(2 / s));
  let rects = '';
  for (let y = crop[1]; y < crop[3]; y += step)
    for (let x = crop[0]; x < crop[2]; x += step)
      if (mask[y * w + x]) rects += `<rect x="${((x - crop[0]) * s).toFixed(1)}" y="${((y - crop[1]) * s).toFixed(1)}" width="${(step * s + 0.5).toFixed(1)}" height="${(step * s + 0.5).toFixed(1)}"/>`;
  return `<g fill="#ff0000" fill-opacity="0.35">${rects}</g>`;
}

async function toMask(img: RGBA, box: Box, polys: number[][][], crop: Box, s: number, w: number, h: number): Promise<Mask> {
  const mapped = polys
    .filter((p) => Array.isArray(p) && p.length >= 3)
    .map((p) => p.filter((q) => q.length === 2 && q.every(Number.isFinite)).map(([x, y]) => [x / s + crop[0], y / s + crop[1]] as [number, number]));
  const rough = await polygonsToMask(mapped, w, h);
  // polygon outlines from a language model are approximate: snap them to colour edges
  const r = Math.round(Math.max(2, Math.min(10, 0.03 * Math.max(box[2] - box[0], box[3] - box[1]))));
  return snapToEdges(img, rough, box, r);
}

/** [model_3 extract]  work_image + detection_prompts → masks */
export async function segment(img: RGBA, prompt: DetectionPrompt, tmpDir: string, description = ''): Promise<MaskResult> {
  const c = await makeCrop(img, prompt.box, tmpDir);
  const r = await callModel<{ polygons: number[][][]; confidence: number }>({
    role: 'model_3',
    system: SYSTEM,
    images: [c.file],
    schema: polySchema,
    prompt:
      `Crop size ${c.outW}x${c.outH} px. Target: "${prompt.label}"${description ? ` (${description})` : ''}, inside the dashed cyan box.\n` +
      `Return polygons outlining the whole visible target (several polygons if it is in separate pieces) and your confidence 0..1 that the outline is accurate.`,
  });
  return { prompt, mask: await toMask(img, prompt.box, r.polygons, c.crop, c.s, img.width, img.height), confidence: clamp01(r.confidence) };
}

/** [model_3 modify]  masks + quality → refined_masks (process 5) */
export async function refine(img: RGBA, prev: MaskResult, problem: string, tmpDir: string): Promise<MaskResult> {
  const c = await makeCrop(img, prev.prompt.box, tmpDir, prev.mask);
  const r = await callModel<{ polygons: number[][][]; confidence: number }>({
    role: 'model_3',
    system: SYSTEM,
    images: [c.file],
    schema: polySchema,
    prompt:
      `Crop size ${c.outW}x${c.outH} px. Target: "${prev.prompt.label}" inside the dashed cyan box. ` +
      `The red overlay is a previous mask attempt that failed a check: ${problem}.\n` +
      `Trace a corrected outline of the whole target: cover all of it, exclude the background, and stay within the box. Return polygons and confidence 0..1.`,
  });
  return { prompt: prev.prompt, mask: await toMask(img, prev.prompt.box, r.polygons, c.crop, c.s, img.width, img.height), confidence: clamp01(r.confidence) };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
