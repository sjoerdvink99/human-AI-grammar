// Client-side part of tool_3 (source alignment): keep spans anchored while the
// draft changes, and locate the origin of a gold node in the draft (process 7).
import type { CardOrigin, HighlightSpan } from "../../shared/types.ts";

function nearestOccurrence(text: string, phrase: string, near: number): number {
  let best = -1, bestDist = Infinity, i = text.indexOf(phrase);
  while (i >= 0) {
    const d = Math.abs(i - near);
    if (d < bestDist) { best = i; bestDist = d; }
    i = text.indexOf(phrase, i + 1);
  }
  return best;
}

/** Re-anchor highlight spans after the draft was edited; spans whose text vanished are dropped. */
export function reanchor(draft: string, spans: HighlightSpan[]): HighlightSpan[] {
  const out: HighlightSpan[] = [];
  for (const s of spans) {
    if (draft.slice(s.start, s.end) === s.text) { out.push(s); continue; }
    const i = nearestOccurrence(draft, s.text, s.start);
    if (i >= 0) out.push({ ...s, start: i, end: i + s.text.length });
  }
  return out.filter((s, i) => !out.slice(0, i).some((o) => s.start < o.end && o.start < s.end));
}

/** [tool_3 match] (process 7): gold_node + draft -> origin_span */
export function locateOriginSpan(draft: string, origin: Extract<CardOrigin, { kind: "highlight" }>): { start: number; end: number } | null {
  if (draft.slice(origin.start, origin.end) === origin.spanText) return { start: origin.start, end: origin.end };
  const withContext = origin.contextBefore + origin.spanText;
  const c = draft.indexOf(withContext);
  if (c >= 0) { const start = c + origin.contextBefore.length; return { start, end: start + origin.spanText.length }; }
  const withAfter = origin.spanText + origin.contextAfter;
  const a = draft.indexOf(withAfter);
  if (a >= 0) return { start: a, end: a + origin.spanText.length };
  let i = nearestOccurrence(draft, origin.spanText, origin.start);
  if (i < 0) i = nearestOccurrence(draft.toLowerCase(), origin.spanText.toLowerCase(), origin.start);
  return i >= 0 ? { start: i, end: i + origin.spanText.length } : null;
}
