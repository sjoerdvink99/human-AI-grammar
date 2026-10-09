# PLAN — System X

The design (`design.json`) has no goal, description, representation descriptions, references or images. From the
expressions it is a **knowledge-grounded writing workspace**: source documents become a knowledge graph; the
writer's draft is checked against the graph (highlighted spans → explanation cards); the writer can ask questions
of the graph (answers → query cards); cards are arranged on a canvas whose nodes link back to their origin
(draft span or chat turn); editing the draft recomputes a semantic frame that steers the next analysis.

## Stack (repository was empty — default taken)

- Node 20 + TypeScript everywhere. Backend: Express (`server/`), run with `tsx`. Frontend: React + Vite (`client/`).
- Shared types and deterministic tools in `shared/` (used by both sides, unit-tested with Vitest).
- `model_1` (LLM): `callModel()` in `server/model.ts` → spawns `claude -p --output-format json --json-schema …`
  with `CLAUDECODE` removed from the environment. One function; swap provider there.
- `model_2` (translate concepts → vectors): `embed()` in `server/embed.ts`, a local sentence-embedding model
  (Transformers.js, `Xenova/all-MiniLM-L6-v2`), with a deterministic hashed n-gram fallback if the model cannot load.
  The Claude CLI cannot return embeddings, so this is the one model step not routed through it (see NOTES.md).
- Canvas: `@xyflow/react`. Knowledge-graph view: SVG + `d3-force`.
- Persistence: knowledge graph in `data/kg.json` on the server; draft / cards / canvas / chat in `localStorage`.

## Representations

| identifier | type | contents | file |
| --- | --- | --- | --- |
| source_documents | `SourceDocument[]` | `{id,title,text}` pasted or uploaded (.txt/.md) | shared/types.ts, client SourcesPanel |
| domain_entities | `DomainEntity[]` | `{id,name,type,description,aliases,sourceDocIds}` | shared/types.ts |
| domain_relations | `DomainRelation[]` | `{id,source,target,predicate,evidence,sourceDocId}` | shared/types.ts |
| knowledge_graph | `KnowledgeGraph` | `{nodes: DomainEntity[], links: DomainRelation[], documents}` | shared/types.ts, data/kg.json |
| draft | `string` | the writer's text (textarea with highlight backdrop) | client DraftEditor |
| canvas | `CanvasGraph` | `{nodes: CanvasNode[] (gold/silver), edges: CanvasEdge[]}` | shared/types.ts, client CanvasView |
| semantic_frame | `SemanticFrame` | `{keyTerms, canvasEntities, canvasRelations, focus, wordCount}` | shared/tools.ts |
| draft_concepts / query_concepts | `Concept[]` | `{mention, concept}`; draft mentions must occur verbatim in the draft | shared/types.ts |
| concept_vectors / query_vectors | `number[][]` | normalized embeddings, one per concept | server/embed.ts |
| candidate_facts / query_facts | `Fact[]` | `{id,mention,entityId,entityName,statements,relationIds,score,sourceDocIds}` | shared/types.ts |
| highlight_spans | `HighlightSpan[]` | `{id,start,end,text,factIds}` | shared/tools.ts |
| clicked_span | `HighlightSpan` | the span the writer clicked | client App state |
| card_explanation | `string` | 2–4 sentence explanation (generated) | server/pipeline.ts |
| highlight_card | `HighlightCard` | `{id,kind:'highlight',span,explanation,facts}` | shared/types.ts |
| query | `string` | the writer's question | client ChatPanel |
| query_answer | `ChatTurn.answer` | answer text with `[F#]` citations | server/pipeline.ts |
| query_cards | `QueryCard[]` | one card per matched entity, `{id,kind:'query',turnId,title,facts}` | shared/tools.ts |
| text_card_links | `TextCardLink[]` | `{cardId,start,end}` ranges of the answer tied to a card | shared/tools.ts |
| chosen_highlight_card / chosen_query_card | card id | cards the writer selected for the canvas | client CardsTray |
| related_edges | `CanvasEdge[]` | KG relations (direct or 2-hop) between canvas nodes' entities | shared/tools.ts |
| gold_node / silver_node | `CanvasNode` | clicked canvas node (gold = from highlight card, silver = from query card) | client CanvasView |
| origin_span | `{start,end}` | the draft span a gold node came from, re-located in the current draft | shared/tools.ts |
| query_turn | turn id | the chat turn a silver node came from | client ChatPanel |

## Transformations

| process | actor op | function / component | file |
| --- | --- | --- | --- |
| 1 | model_1 extract | `extractDomain()` (per document chunk) | server/pipeline.ts |
| 1 | tool_1 compose | `composeKnowledgeGraph()` | shared/tools.ts |
| 2, 9 | tool_2 compose | `composeSemanticFrame(draft, canvas)` | shared/tools.ts |
| 3 | model_1 extract | `extractConcepts('draft', …)` | server/pipeline.ts |
| 3 | model_2 translate | `embed()` | server/embed.ts |
| 3 | tool_1 match | `matchFacts()` | server/match.ts |
| 3 | tool_3 select | `selectHighlightSpans()` | shared/tools.ts |
| 4 | human select | click a highlighted span | client DraftEditor |
| 4 | model_1 generate~ | `generateExplanation()` (loading, regenerate) | server/pipeline.ts |
| 4 | tool_3 compose | `composeHighlightCard()` | shared/tools.ts |
| 5 | human specify | question box | client ChatPanel |
| 5 | model_1 extract | `extractConcepts('query', …)` | server/pipeline.ts |
| 5 | model_2 translate | `embed()` | server/embed.ts |
| 5 | tool_1 match | `matchFacts()` | server/match.ts |
| 5 | model_1 generate~ | `generateAnswer()` (loading, citation validation) | server/pipeline.ts |
| 5 | tool_3 compose | `composeQueryCards()` | shared/tools.ts |
| 5 | tool_3 match | `linkAnswerToCards()` | shared/tools.ts |
| 6 | human select | select cards (checkbox / drag) → "Add to canvas" | client CardsTray, CanvasView |
| 6 | tool_3 compose | `addCardsToCanvas()` | shared/tools.ts |
| 6 | tool_1 match | `matchRelatedEdges()` | shared/tools.ts |
| 6 | tool_3 compose | `composeCanvasEdges()` | shared/tools.ts |
| 7 | human select | click a gold node | client CanvasView |
| 7 | tool_3 match | `locateOriginSpan()` → select + flash span in draft | shared/tools.ts, DraftEditor |
| 8 | human select | click a silver node | client CanvasView |
| 8 | tool_3 match | `findQueryTurn()` → scroll + flash chat turn | shared/tools.ts, ChatPanel |
| 9 | human modify | typing in the draft | client DraftEditor |
| 9 | tool_2 compose | `composeSemanticFrame()` (recomputed on every edit, shown as chips) | shared/tools.ts |

## Triggers (design has no descriptions; defaults taken)

- Process 1: "Build knowledge graph" button after adding documents (rebuild replaces the graph).
- Process 2/9: semantic frame recomputed whenever the draft or canvas changes.
- Process 3: runs automatically 2.5 s after the writer stops typing (toggle "Auto-check"), and via a "Check draft" button.
- Process 4: clicking inside a highlighted span.
- Process 5: submitting a question.
- Process 6: "Add to canvas" with selected cards, or dragging a card onto the canvas.
- Process 7/8: clicking a canvas node.

## Layout

Three columns: Draft (left) · Canvas over a Cards tray (middle) · tabbed Ask / Sources & graph (right).

No images in the design. No steps added beyond the design.
