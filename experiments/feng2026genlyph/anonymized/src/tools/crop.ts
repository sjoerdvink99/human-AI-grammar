import type { Crop, Segment, SegmentLabel } from "../types.ts";
import { cropSvg } from "./svg.ts";

/**
 * tool_2 extract: r11 + r13_2* + r14* -> r15* (crops) + r16* (their boxes).
 * Only segments labelled as "mark" with a bound field become crops.
 */
export function cropSegments(r11: string, r13: Segment[], r14: SegmentLabel[]): Crop[] {
  const out: Crop[] = [];
  for (const seg of r13) {
    const label = r14.find((l) => l.segmentId === seg.id);
    if (!label || label.role !== "mark" || !label.field) continue;
    out.push({
      segmentId: seg.id,
      name: seg.name,
      field: label.field,
      svg: cropSvg(r11, seg.elementIds, seg.bbox),
      bbox: seg.bbox,
    });
  }
  return out;
}
