// Process 6 — Curate Knowledge on Canvas (tool_3 compose steps).
import type { Canvas, CanvasEdge, KnowledgeCard } from "../../shared/types.ts";

/** [tool_3 compose]: canvas_1 + chosen card -> canvas_2 (gold for highlight cards, silver for query cards) */
export function addCardToCanvas(canvas: Canvas, card: KnowledgeCard): Canvas {
  if (canvas.nodes.some((n) => n.card.id === card.id)) return canvas;
  const i = canvas.nodes.length;
  const tone = card.origin.kind === "highlight" ? "gold" : "silver";
  const col = i % 2, row = Math.floor(i / 2);
  const node = { id: `n-${card.id}`, tone, card, x: 40 + col * 300 + (row % 2) * 30, y: 40 + row * 220 } as const;
  return { ...canvas, nodes: [...canvas.nodes, node] };
}

/** [tool_3 compose]: canvas_2 + related_edges -> canvas_3 (automatic edges are replaced, others kept) */
export function mergeRelatedEdges(canvas: Canvas, related: CanvasEdge[]): Canvas {
  const ids = new Set(canvas.nodes.map((n) => n.id));
  const manual = canvas.edges.filter((e) => !e.auto);
  return { ...canvas, edges: [...manual, ...related.filter((e) => ids.has(e.source) && ids.has(e.target))] };
}

export function removeNode(canvas: Canvas, id: string): Canvas {
  return { nodes: canvas.nodes.filter((n) => n.id !== id), edges: canvas.edges.filter((e) => e.source !== id && e.target !== id) };
}
