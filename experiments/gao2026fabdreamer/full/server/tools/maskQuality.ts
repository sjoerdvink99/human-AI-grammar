// tool_1 evaluate: mask confidence and bounding-box fit checks (process 5).
import type { Box, MaskQuality } from '../../shared/types.js';
import { boxIoU, maskArea, maskBox, type Mask } from './raster.js';

export const MIN_CONFIDENCE = 0.55;
export const MIN_BOX_IOU = 0.5;
export const MIN_AREA_RATIO = 0.12; // mask area relative to its detection box

export function evaluateMask(mask: Mask, w: number, h: number, box: Box, confidence: number, stage: MaskQuality['stage']): MaskQuality {
  const mb = maskBox(mask, w, h);
  const boxArea = Math.max(1, (box[2] - box[0]) * (box[3] - box[1]));
  const bboxIoU = mb ? boxIoU(mb, box) : 0;
  const areaRatio = maskArea(mask) / boxArea;
  return {
    confidence,
    bboxIoU,
    areaRatio,
    stage,
    pass: confidence >= MIN_CONFIDENCE && bboxIoU >= MIN_BOX_IOU && areaRatio >= MIN_AREA_RATIO,
  };
}

export function describeProblem(q: MaskQuality) {
  const p: string[] = [];
  if (q.confidence < MIN_CONFIDENCE) p.push(`low confidence (${q.confidence.toFixed(2)})`);
  if (q.bboxIoU < MIN_BOX_IOU) p.push(`mask does not fit the box (IoU ${q.bboxIoU.toFixed(2)})`);
  if (q.areaRatio < MIN_AREA_RATIO) p.push(`mask covers too little of the box (${(q.areaRatio * 100).toFixed(0)}%)`);
  return p.join('; ') || 'ok';
}
