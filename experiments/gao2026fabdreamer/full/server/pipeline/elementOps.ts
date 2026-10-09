// Processes 6 (Grab an additional element), 8 (Repair a noisy element), 9 (Split a compound element).
import sharp from 'sharp';
import type { Element, Project, Workspace } from '../../shared/types.js';
import * as vlm from '../models/vlm.js';
import * as imageModel from '../models/imageModel.js';
import * as segmenter from '../models/segmenter.js';
import { cropMask, diffMask, loadMask, loadRGBA, maskArea, maskBox, padBox, saveRGBA, cropRGBA, cutout, type Mask } from '../tools/raster.js';
import { maskToElement, updateElementGeometry } from '../tools/vectorize.js';
import { filePath, projectDir, saveProject, uid } from '../store.js';
import { pushCanvasHistory } from './history.js';

// ---------------- process 6 ----------------

/** [model_2 generate]~  grab_request → grab_candidates */
export async function grabCandidates(p: Project, ws: Workspace, request: string, log: (s: string) => void) {
  log('Generating candidate images (model_2)');
  const imgs = await imageModel.generateGrabCandidates(request, ws.style);
  const files: string[] = [];
  for (const img of imgs) {
    const f = `grab_${uid()}.png`;
    await saveRGBA(img, filePath(p.id, f));
    files.push(f);
  }
  ws.grab = { request, candidates: files };
  saveProject(p);
}

/** [human select] → grab_image ; [model_1 evaluate] → occlusion ; [model_2 generate]~ → isolated_grab ;
 *  [tool_1 extract] → grab_mask ; [tool_1 translate] → grab_element */
export async function grabSelect(p: Project, ws: Workspace, index: number, layerId: string, log: (s: string) => void) {
  const g = ws.grab;
  if (!g || !g.candidates[index]) throw new Error('no such candidate');
  g.chosen = g.candidates[index];
  const chosenPath = filePath(p.id, g.chosen);
  log('Checking whether the object is partly hidden (model_1)');
  g.occlusion = await vlm.evaluateOcclusion(chosenPath, g.request);
  saveProject(p);
  const meta = await sharp(chosenPath).metadata();
  const w = meta.width!;
  const h = meta.height!;
  log(g.occlusion === 'occluded' ? 'Completing the hidden parts on a plain background (model_2)' : 'Redrawing the object on a plain background (model_2)');
  const isolated = await imageModel.isolateOnWhite(chosenPath, w, h, g.request, g.occlusion === 'occluded');
  const isoFile = `grab_iso_${uid()}.png`;
  await saveRGBA(isolated, filePath(p.id, isoFile));
  g.isolated = isoFile;
  log('Extracting mask by background removal (tool_1)');
  const mask = diffMask(isolated);
  if (maskArea(mask) < 50) throw new Error('could not separate the object from the background');
  const el = await maskToElement(p.id, isolated, mask, { name: g.request.slice(0, 40), layerId, origin: 'grab' });
  if (!el) throw new Error('empty element');
  delete el.sourceBox;
  addToCanvas(ws, el);
  g.elementId = el.id;
  saveProject(p);
  log('Added element to the canvas');
  return el;
}

function addToCanvas(ws: Workspace, el: Element) {
  const c = ws.canvas!;
  pushCanvasHistory(ws);
  const layer = c.layers.find((l) => l.id === el.layerId) ?? c.layers[0];
  el.layerId = layer.id;
  el.scale = Math.min(1, (0.4 * Math.min(c.width, c.height)) / Math.max(el.width, el.height));
  el.x = c.width / 2;
  el.y = c.height / 2;
  ws.elements[el.id] = el;
  layer.elementIds.push(el.id);
}

// ---------------- process 8 ----------------

/** [tool_1 extract] → element_crop ; [model_2 modify]~ → repaired_element ; [tool_1 translate] → repaired_geometry */
export async function repairElement(p: Project, ws: Workspace, elementId: string, log: (s: string) => void) {
  const el = ws.elements[elementId];
  if (!el) throw new Error('element not found');
  const src = p.sourceVersions.find((v) => v.id === ws.sourceId)!;
  let cropFile = `tmp_repair_crop_${uid()}.png`;
  let cw: number, ch: number;
  let offset: [number, number] | null = null;
  log('Cropping the original image around the element (tool_1)');
  if (el.sourceBox) {
    const img = await loadRGBA(filePath(p.id, src.file));
    const box = padBox(el.sourceBox, 10, img.width, img.height);
    await saveRGBA(cropRGBA(img, box), filePath(p.id, cropFile));
    cw = box[2] - box[0];
    ch = box[3] - box[1];
    offset = [box[0], box[1]];
  } else {
    await sharp(filePath(p.id, el.texture)).flatten({ background: '#ffffff' }).png().toFile(filePath(p.id, cropFile));
    cw = el.width;
    ch = el.height;
  }
  log('Regenerating a clean version of the element (model_2)');
  const repaired = await imageModel.isolateOnWhite(filePath(p.id, cropFile), cw, ch, el.name, true);
  log('Converting to vector geometry (tool_1)');
  const mask = diffMask(repaired);
  const b = maskBox(mask, cw, ch);
  if (!b || maskArea(mask) < 30) throw new Error('repaired element was empty');
  const box = padBox(b, 2, cw, ch);
  const local = cropMask(mask, cw, box, ch);
  const tex = cutout(repaired, mask, box);
  pushCanvasHistory(ws);
  let next = await updateElementGeometry(p.id, el, local, tex);
  next.origin = el.origin === 'background' ? 'background' : 'repair';
  if (offset && el.sourceBox) {
    // move centre by the shift between old and new source boxes (in canvas space, honouring scale/rotation)
    const nb: [number, number, number, number] = [box[0] + offset[0], box[1] + offset[1], box[2] + offset[0], box[3] + offset[1]];
    const dx = (nb[0] + nb[2]) / 2 - (el.sourceBox[0] + el.sourceBox[2]) / 2;
    const dy = (nb[1] + nb[3]) / 2 - (el.sourceBox[1] + el.sourceBox[3]) / 2;
    const r = (el.rotation * Math.PI) / 180;
    next = { ...next, sourceBox: nb, x: el.x + el.scale * (dx * Math.cos(r) - dy * Math.sin(r)), y: el.y + el.scale * (dx * Math.sin(r) + dy * Math.cos(r)) };
  }
  ws.elements[el.id] = next;
  saveProject(p);
  return next;
}

// ---------------- process 9 ----------------

/** [model_1 extract] → part_prompts ; [model_3 extract] → part_masks ; [tool_1 translate] → split_parts */
export async function splitElement(p: Project, ws: Workspace, elementId: string, request: string, log: (s: string) => void) {
  const el = ws.elements[elementId];
  if (!el) throw new Error('element not found');
  const flatFile = `tmp_split_${uid()}.png`;
  await sharp(filePath(p.id, el.texture)).flatten({ background: '#ffffff' }).png().toFile(filePath(p.id, flatFile));
  const flat = await loadRGBA(filePath(p.id, flatFile));
  const tex = await loadRGBA(filePath(p.id, el.texture));
  const { mask: elMask } = await loadMask(filePath(p.id, el.mask));
  const w = el.width;
  const h = el.height;

  log('Locating the requested parts (model_1)');
  const prompts = await vlm.locateParts(filePath(p.id, flatFile), w, h, request, el.name);
  if (prompts.length < 2) throw new Error('the model found fewer than two parts to separate');
  log(`Segmenting ${prompts.length} parts (model_3)`);
  const results = await Promise.all(prompts.map((pr) => segmenter.segment(flat, pr, projectDir(p.id))));

  // resolve overlaps: a pixel goes to the smallest part claiming it; unclaimed pixels go to the nearest box
  const parts: Mask[] = results.map((r) => r.mask.map((v, i) => (v && elMask[i] ? 1 : 0)) as Mask);
  const areas = parts.map(maskArea);
  const owner = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (!elMask[i]) continue;
    let best = -1;
    for (let k = 0; k < parts.length; k++) if (parts[k][i] && (best < 0 || areas[k] < areas[best])) best = k;
    if (best < 0) {
      const x = i % w;
      const y = (i - x) / w;
      let bd = Infinity;
      prompts.forEach((pr, k) => {
        const cx = Math.max(pr.box[0], Math.min(x, pr.box[2]));
        const cy = Math.max(pr.box[1], Math.min(y, pr.box[3]));
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
    }
    owner[i] = best;
  }

  log('Converting parts to vector shapes (tool_1)');
  const created: Element[] = [];
  for (let k = 0; k < prompts.length; k++) {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (owner[i] === k) m[i] = 1;
    const part = await maskToElement(p.id, tex, m, { name: `${el.name} – ${prompts[k].label}`, layerId: el.layerId, origin: 'split' });
    if (!part) continue;
    // local (element) coordinates → canvas coordinates through the parent's transform
    const lx = part.x - w / 2;
    const ly = part.y - h / 2;
    const r = (el.rotation * Math.PI) / 180;
    part.x = el.x + el.scale * (lx * Math.cos(r) - ly * Math.sin(r));
    part.y = el.y + el.scale * (lx * Math.sin(r) + ly * Math.cos(r));
    part.scale = el.scale;
    part.rotation = el.rotation;
    part.sourceBox = el.sourceBox
      ? [el.sourceBox[0] + part.sourceBox![0], el.sourceBox[1] + part.sourceBox![1], el.sourceBox[0] + part.sourceBox![2], el.sourceBox[1] + part.sourceBox![3]]
      : undefined;
    created.push(part);
  }
  if (created.length < 2) throw new Error('split produced fewer than two parts');
  pushCanvasHistory(ws);
  const layer = ws.canvas!.layers.find((l) => l.id === el.layerId)!;
  const idx = layer.elementIds.indexOf(el.id);
  layer.elementIds.splice(idx, 1, ...created.map((c) => c.id));
  delete ws.elements[el.id];
  for (const c of created) ws.elements[c.id] = c;
  saveProject(p);
  return created;
}
