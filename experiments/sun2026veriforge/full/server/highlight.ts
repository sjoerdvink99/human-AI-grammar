// Process 3 — Proactively Highlight Knowledge Gaps
// (draft_1 + semantic_frame_1 + knowledge_graph_1) -> [model_1 extract] -> (draft_concepts_1)*
// -> [model_2 translate] -> (concept_vectors_1)* -> [tool_1 match] -> (candidate_facts_1)*
// -> [tool_3 select] -> (highlight_spans_1)*
import { callModel } from "./model.ts";
import { embed } from "./embed.ts";
import { frameToPrompt } from "./context.ts";
import { selectHighlightSpans } from "./align.ts";
import type { GraphDB } from "./graphdb.ts";
import type { DraftConcept, Fact, HighlightSpan, SemanticFrame } from "../shared/types.ts";

const SYSTEM = `You help a fiction writer notice domain knowledge they may be missing.
Given the writer's current context, list the domain-specific concepts in the draft text (technical terms, historical items, procedures, places, jargon, objects of a specialised field) where accurate background knowledge could matter.
Rules:
- "phrase" MUST be copied verbatim from the DRAFT TEXT (exact characters, 1-6 words).
- "concept" is the canonical name of the domain concept.
- "reason" is a few words on why the writer might need knowledge about it.
- Ignore character names and everyday words. Return at most 10 concepts, most relevant to the current passage first.`;

const SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: { phrase: { type: "string" }, concept: { type: "string" }, reason: { type: "string" } },
        required: ["phrase", "concept", "reason"],
      },
    },
  },
  required: ["concepts"],
};

/** [model_1 extract]: draft + semantic_frame -> draft_concepts* */
export async function extractDraftConcepts(draft: string, frame: SemanticFrame | null): Promise<DraftConcept[]> {
  const text = draft.slice(-4000);
  const out = await callModel<{ concepts: DraftConcept[] }>({
    op: "extract draft concepts",
    system: SYSTEM,
    prompt: `WRITING CONTEXT\n${frameToPrompt(frame)}\n\nDRAFT TEXT\n"""${text}"""`,
    schema: SCHEMA,
  });
  // validation: phrase must occur in the draft
  const lower = draft.toLowerCase();
  return (out.concepts ?? []).filter((c) => c.phrase?.trim() && lower.includes(c.phrase.toLowerCase())).slice(0, 10);
}

export async function highlightGaps(db: GraphDB, draft: string, frame: SemanticFrame | null): Promise<{ spans: HighlightSpan[]; facts: Fact[]; concepts: DraftConcept[] }> {
  if (draft.trim().length < 20 || db.stats().entityCount === 0) return { spans: [], facts: [], concepts: [] };
  const concepts = (await extractDraftConcepts(draft, frame)).map((c, i) => ({ ...c, key: `c${i}` }));
  const vectors = await embed(concepts.map((c) => `${c.concept} ${c.phrase}`)); // [model_2 translate]
  const facts = db.match(concepts.map((c, i) => ({ key: c.key, text: c.concept, vector: vectors[i] })), 1); // [tool_1 match]
  const spans = selectHighlightSpans(draft, concepts, facts, frame?.canvasTopics ?? []); // [tool_3 select]
  const used = new Set(spans.flatMap((s) => s.factIds));
  return { spans, facts: facts.filter((f) => used.has(f.id)), concepts };
}
