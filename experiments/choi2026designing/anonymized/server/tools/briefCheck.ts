import type { Brief, BriefStatus, BriefTemplate } from "../../shared/types.ts";

/** P1 [tool_1 evaluate]: r3 brief (against r1 template) → r4 status (complete | incomplete). */
export function checkBrief(template: BriefTemplate, brief: Brief): BriefStatus {
  const missing = template.filter((f) => f.required && !(brief[f.key] ?? "").trim()).map((f) => f.key);
  return { status: missing.length ? "incomplete" : "complete", missing };
}
