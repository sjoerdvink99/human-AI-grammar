// Process 5: Recover difficult segmentations.
// tool_1 evaluate → model_3 modify → tool_1 evaluate → model_2 generate~ → tool_1 extract → (tool_1 translate in caller)
import path from 'node:path';
import type { MaskQuality } from '../../shared/types.js';
import * as segmenter from '../models/segmenter.js';
import * as imageModel from '../models/imageModel.js';
import { describeProblem, evaluateMask } from '../tools/maskQuality.js';
import { cropRGBA, diffMask, padBox, saveRGBA, type Mask, type RGBA } from '../tools/raster.js';
import { uid } from '../store.js';

export interface RecoveredMask {
  mask: Mask;
  quality: MaskQuality;
}

export async function recoverMask(
  work: RGBA,
  initial: segmenter.MaskResult,
  description: string,
  tmpDir: string,
  log: (s: string) => void,
): Promise<RecoveredMask> {
  const { width: w, height: h } = work;
  const box = initial.prompt.box;
  // [tool_1 evaluate] masks → mask_quality
  const q1 = evaluateMask(initial.mask, w, h, box, initial.confidence, 'initial');
  if (q1.pass) return { mask: initial.mask, quality: q1 };
  log(`mask for "${initial.prompt.label}" failed checks: ${describeProblem(q1)} → refining`);

  // [model_3 modify] → refined_masks
  let best: RecoveredMask = { mask: initial.mask, quality: q1 };
  try {
    const refined = await segmenter.refine(work, initial, describeProblem(q1), tmpDir);
    // [tool_1 evaluate] → mask_quality_2
    const q2 = evaluateMask(refined.mask, w, h, box, refined.confidence, 'refined');
    if (q2.pass) return { mask: refined.mask, quality: q2 };
    if (score(q2) > score(q1)) best = { mask: refined.mask, quality: q2 };
    log(`refined mask for "${initial.prompt.label}" still inadequate: ${describeProblem(q2)} → redraw fallback`);
  } catch (e) {
    log(`refinement failed (${(e as Error).message.slice(0, 80)}) → redraw fallback`);
  }

  // [model_2 generate]~ → isolated_elements ; [tool_1 extract] → fallback_masks
  try {
    const fb = await fallbackMask(work, box, initial.prompt.label + (description ? ` (${description})` : ''), tmpDir);
    const qf = evaluateMask(fb, w, h, box, 0.7, 'fallback');
    if (qf.areaRatio > 0.05) return { mask: fb, quality: { ...qf, pass: true } };
  } catch (e) {
    log(`fallback redraw failed: ${(e as Error).message.slice(0, 80)}`);
  }
  return best;
}

const score = (q: MaskQuality) => q.confidence + q.bboxIoU + Math.min(1, q.areaRatio);

/** Redraw the element alone on white, then recover its mask by differencing with the uniform background. */
export async function fallbackMask(work: RGBA, box: [number, number, number, number], what: string, tmpDir: string): Promise<Mask> {
  const crop = padBox(box, 8, work.width, work.height);
  const cw = crop[2] - crop[0];
  const ch = crop[3] - crop[1];
  const cropFile = path.join(tmpDir, `tmp_crop_${uid()}.png`);
  await saveRGBA(cropRGBA(work, crop), cropFile);
  const isolated = await imageModel.isolateOnWhite(cropFile, cw, ch, what, false);
  await saveRGBA(isolated, path.join(tmpDir, `tmp_isolated_${uid()}.png`));
  const local = diffMask(isolated, [255, 255, 255]);
  const full = new Uint8Array(work.width * work.height);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) full[(y + crop[1]) * work.width + x + crop[0]] = local[y * cw + x];
  return full;
}
