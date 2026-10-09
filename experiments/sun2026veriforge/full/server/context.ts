// tool_2: asynchronous context management component.
// Process 2 / 9: (draft) + (canvas) -> [tool_2 compose] -> (semantic_frame)
import type { Canvas, SemanticFrame } from "../shared/types.ts";

const STOP = new Set(
  ("the a an and or but of to in on at for with by from as is are was were be been it its this that these those he she they them his her their " +
    "i you we me my your our not no so if then than there here what which who whom when where why how all any some into out up down over under " +
    "three four five six seven eight nine ten first second third days day time way thought knew felt looked " +
    "had has have do did does would could should will can just like said one two very too more most only also back again").split(" "),
);

let version = 0;

export function salientTerms(text: string, n = 15): string[] {
  const counts = new Map<string, number>();
  const words = text.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (STOP.has(lw)) continue;
    counts.set(lw, (counts.get(lw) ?? 0) + (w[0] === w[0].toUpperCase() ? 1.5 : 1));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/** [tool_2 compose] */
export function composeSemanticFrame(draft: string, canvas: Canvas): SemanticFrame {
  const recent = draft.slice(-1500);
  const focusExcerpt = recent.length < draft.length ? recent.replace(/^\S*\s/, "") : recent;
  const byId = new Map(canvas.nodes.map((n) => [n.id, n.card.concept]));
  return {
    version: ++version,
    focusExcerpt,
    salientTerms: salientTerms(draft),
    canvasTopics: canvas.nodes.map((n) => n.card.concept),
    canvasRelations: canvas.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => `${byId.get(e.source)} —${e.label}→ ${byId.get(e.target)}`),
    draftLength: draft.length,
    updatedAt: new Date().toISOString(),
  };
}

export function frameToPrompt(f: SemanticFrame | null | undefined): string {
  if (!f) return "(no writing context yet)";
  return [
    `Salient terms in the draft: ${f.salientTerms.join(", ") || "none"}`,
    `Topics the author already saved on the Knowledge Canvas: ${f.canvasTopics.join(", ") || "none"}`,
    f.canvasRelations.length ? `Canvas connections: ${f.canvasRelations.join("; ")}` : "",
    `Current passage being written:\n"""${f.focusExcerpt}"""`,
  ].filter(Boolean).join("\n");
}
