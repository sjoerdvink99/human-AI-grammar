import type {
  Canvas, CanvasEdge, DraftConcept, Fact, GraphStats, HighlightSpan, IngestJob, KnowledgeCard, Passage, QueryTurn, SemanticFrame,
} from "../../shared/types.ts";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  graph: () => req<GraphStats>("GET", "/api/graph"),
  clearGraph: () => req<GraphStats>("DELETE", "/api/graph"),
  ingest: (files: { title: string; text: string }[]) => req<IngestJob>("POST", "/api/ingest", { files }),
  job: (id: string) => req<IngestJob>("GET", `/api/ingest/${id}`),
  passage: (id: string) => req<Passage>("GET", `/api/passage/${encodeURIComponent(id)}`),
  frame: (draft: string, canvas: Canvas) => req<SemanticFrame>("POST", "/api/frame", { draft, canvas }),
  highlight: (draft: string) =>
    req<{ spans: HighlightSpan[]; facts: Fact[]; concepts: DraftConcept[]; frameVersion: number }>("POST", "/api/highlight", { draft }),
  card: (draft: string, span: HighlightSpan, facts: Fact[]) => req<KnowledgeCard>("POST", "/api/card", { draft, span, facts }),
  query: (query: string) => req<QueryTurn>("POST", "/api/query", { query }),
  relate: (nodes: { id: string; concept: string; entityKeys: string[] }[]) => req<CanvasEdge[]>("POST", "/api/canvas/relate", { nodes }),
};
