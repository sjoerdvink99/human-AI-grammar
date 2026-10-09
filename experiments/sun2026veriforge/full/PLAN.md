# PLAN — System X (mixed-initiative fiction writing with domain knowledge)

Design: `design.json` (9 processes, no references, no images). Plan auto-confirmed with recommended defaults (controlled experiment).

## Stack (repository was empty)

- One npm package, TypeScript everywhere.
- Backend: Node 20 + Express, run with `tsx`. Model calls go through `server/model.ts#callModel` (Claude Code CLI `claude -p --output-format json --json-schema …`, spawned with `CLAUDECODE` removed). Embeddings go through `server/embed.ts#embed` (local hashed n-gram embedding; swappable).
- Frontend: React 18 + Vite; canvas with `@xyflow/react`.
- Persistence: knowledge graph stored as JSON in `data/graph.json` (tool_1); draft, canvas and query history in browser `localStorage`.
- Tests: `vitest` for the deterministic tools.

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| source_documents | `SourceDocument[]` | uploaded .txt/.md reference texts, split into `Passage`s | shared/types.ts, server/ingest.ts |
| domain_entities | `DomainEntity[]` | name, type, description, passageId | shared/types.ts |
| domain_relations | `DomainRelation[]` | source, target, label, passageId | shared/types.ts |
| knowledge_graph | `KnowledgeGraph` | entities (with vectors) + relations + passages + documents | server/graphdb.ts |
| draft | `string` (versioned by edit) | fiction text | web/src/DraftEditor.tsx |
| canvas | `Canvas` = `{nodes: CanvasNode[], edges: CanvasEdge[]}` | saved cards as gold/silver nodes, labeled edges | web/src/KnowledgeCanvas.tsx |
| semantic_frame | `SemanticFrame` | focus excerpt, salient terms, canvas topics, canvas relations, version | server/context.ts |
| draft_concepts | `DraftConcept[]` | phrase (verbatim from draft), concept, reason | server/highlight.ts |
| concept_vectors | `number[][]` | embeddings of draft concepts | server/embed.ts |
| candidate_facts | `Fact[]` | entity, statement, passage (exact source text), score, conceptKey | server/graphdb.ts |
| highlight_spans | `HighlightSpan[]` | start, end, text, factIds | server/align.ts |
| clicked_span | `HighlightSpan` | the clicked span | web/src/App.tsx |
| card_explanation | `string` | ≤ 90-word explanation | server/card.ts |
| highlight_card | `KnowledgeCard` (origin = highlight) | concept, explanation, exact source quote, doc, origin span | server/align.ts |
| query | `string` | the author's question | web/src/QueryPanel.tsx |
| query_concepts | `QueryConcept[]` | concept names | server/query.ts |
| query_vectors | `number[][]` | embeddings | server/embed.ts |
| query_facts | `Fact[]` | multi-hop retrieved facts | server/graphdb.ts |
| query_answer | `string` | conversational answer grounded in facts | server/query.ts |
| query_cards | `KnowledgeCard[]` (origin = query turn) | one per concept with source passage | server/align.ts |
| text_card_links | `TextCardLink[]` | start, end in answer, cardId, color | server/align.ts |
| chosen_highlight_card / chosen_query_card | `KnowledgeCard` | card picked via "Add to canvas" | web/src/App.tsx |
| related_edges | `CanvasEdge[]` | labeled edges between canvas nodes | server/graphdb.ts#relateNodes |
| gold_node / silver_node | `CanvasNode` | clicked canvas node | web/src/KnowledgeCanvas.tsx |
| origin_span | `{start,end}` | located passage in draft | web/src/align.ts |
| query_turn | turn id | conversation turn scrolled into view | web/src/QueryPanel.tsx |

## Transformations

| # | Actor op | Implementation | File |
| --- | --- | --- | --- |
| P1 | model_1 extract | `extractEntities(passage)` | server/ingest.ts |
| P1 | tool_1 compose | `GraphDB.compose(entities, relations)` | server/graphdb.ts |
| P2 | tool_2 compose | `composeSemanticFrame(draft, canvas)` — async, debounced from client | server/context.ts |
| P3 | model_1 extract | `extractDraftConcepts` | server/highlight.ts |
| P3 | model_2 translate | `embed` | server/embed.ts |
| P3 | tool_1 match | `GraphDB.match(vectors, hops=1)` | server/graphdb.ts |
| P3 | tool_3 select | `selectHighlightSpans` | server/align.ts |
| P4 | human select | click on highlighted phrase | web/src/DraftEditor.tsx |
| P4 | model_1 generate~ | `generateCardExplanation` | server/card.ts |
| P4 | tool_3 compose | `composeHighlightCard` | server/align.ts |
| P5 | human specify | query input | web/src/QueryPanel.tsx |
| P5 | model_1 extract | `extractQueryConcepts` | server/query.ts |
| P5 | model_2 translate | `embed` | server/embed.ts |
| P5 | tool_1 match | `GraphDB.match(vectors, hops=2)` | server/graphdb.ts |
| P5 | model_1 generate~ | `generateQueryAnswer` | server/query.ts |
| P5 | tool_3 compose | `composeQueryCards` | server/align.ts |
| P5 | tool_3 match | `linkAnswerToCards` | server/align.ts |
| P6 | human select | "Add to canvas" button on a card | web/src/KnowledgeCard.tsx |
| P6 | tool_3 compose | `addCardToCanvas` (gold/silver node) | web/src/canvasOps.ts |
| P6 | tool_1 match | `GraphDB.relateNodes` via `/api/canvas/relate` | server/graphdb.ts |
| P6 | tool_3 compose | `mergeRelatedEdges` | web/src/canvasOps.ts |
| P7 | human select + tool_3 match | click gold node → `locateOriginSpan` → highlight + scroll draft | web/src/align.ts, App.tsx |
| P8 | human select + tool_3 match | click silver node → scroll to query turn | web/src/QueryPanel.tsx |
| P9 | human modify | editing the draft (no AI prose generation anywhere) | web/src/DraftEditor.tsx |
| P9 | tool_2 compose | same `composeSemanticFrame` on new draft/canvas | server/context.ts |

## Triggers
- P1: user uploads files in the Sources dialog.
- P2/P9 tool_2: client posts draft + canvas 1.5 s after any draft change or immediately after canvas change.
- P3: 5 s after the last keystroke (typing pause).
- P4: click on a highlighted phrase.
- P5: submit in Query Panel.
- P6: "Add to canvas"; edges computed after each addition.
- P7/P8: click on gold/silver node.

## Open choices (defaults taken)
- Model provider: Claude Code CLI (`sonnet` alias, `CLAUDE_MODEL` env override).
- Embedding model: local hashed word+char-trigram vectors (no network); swappable `embed()`.
- Graph DB: in-process graph, JSON-persisted.
- Layout: three columns — Draft | Knowledge Canvas | Query Panel; Sources dialog in the header.
