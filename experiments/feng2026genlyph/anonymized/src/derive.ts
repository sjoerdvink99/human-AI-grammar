/** Deterministic derivations (tool steps) recomputed from state, so they never go stale. */
import type { AppState } from "./store.ts";
import type { ChartSpec, ComposedChart } from "./types.ts";
import { anchorsFromSegments, composeCharts, marksFromData } from "./tools/layout.ts";

export function defaultSpec(s: AppState): ChartSpec | undefined {
  const crop = s.crops.find((c) => s.r19.some((v) => v.segmentId === c.segmentId && v.svg));
  if (!crop) return undefined;
  return {
    categoryField: crop.field,
    valueField: s.r2?.defaultValue ?? "",
    aggregate: "sum",
    layouts: ["in-place", "isotype", "sized-row", "bars"],
    unitValue: 0,
    minSize: 28,
    maxSize: 96,
    sort: "none",
    segmentId: crop.segmentId,
  };
}

/** Process 6: tool_3 extract (r20) -> translate (r22) -> compose (r23) */
export function deriveCharts(s: AppState) {
  const r20 = anchorsFromSegments(s.r13, s.r14);
  if (!s.r21 || !s.r1) return { r20, r22: [], r23: [] as ComposedChart[] };
  const r22 = marksFromData(s.r1, s.r21, s.r19);
  const r23 = composeCharts(r22, r20, s.r21);
  return { r20, r22, r23 };
}
