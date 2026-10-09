# System X

A knowledge-grounded writing workspace built from the Human-AI grammar design in `design.json`.

- **Sources & graph** — paste or upload documents; the model extracts entities and relations into a knowledge graph.
- **Draft** — write; phrases that match the knowledge graph are highlighted. Click one to get an explanation card (gold).
- **Ask** — ask questions of the knowledge graph; answers cite facts, and each matched entity becomes a query card (silver).
  Underlined phrases and citation chips in the answer are linked to their cards.
- **Canvas** — drag cards (or select them and press *Add to canvas*); cards are connected by knowledge-graph relations
  (solid = direct, dashed = two hops). Click a gold node to jump to its phrase in the draft, a silver node to jump to its
  question in the chat.
- **Semantic frame** — recomputed from the draft and canvas on every change and fed into concept extraction.

## Run

Requires Node 20+ and the Claude Code CLI (`claude`) logged in. No API key is needed.

```bash
npm install
npm run dev          # API on :8787, UI on http://localhost:5173
# or
npm run build && npm start   # single server on http://localhost:8787
npm test             # unit tests for the deterministic tool steps
```

Environment variables: `SYSTEMX_MODEL` (Claude model alias for model_1, default `haiku`),
`SYSTEMX_MAX_CONCURRENT` (parallel CLI calls, default 4), `SYSTEMX_EMBEDDER=hash` (skip the local embedding model),
`PORT` (default 8787).

The first start downloads the `Xenova/all-MiniLM-L6-v2` embedding model (~90 MB) into the Transformers.js cache.

## Design → code

| process | step | implementation |
| --- | --- | --- |
| 1 | `[model_1 extract]` source_documents → domain_entities + domain_relations | `extractDomain()` in `server/pipeline.ts` |
| 1 | `[tool_1 compose]` → knowledge_graph | `composeKnowledgeGraph()` in `shared/tools.ts`; `POST /api/kg/build` |
| 2 | `[tool_2 compose]` draft + canvas → semantic_frame | `composeSemanticFrame()` in `shared/tools.ts`; `frame` memo in `client/src/App.tsx` |
| 3 | `[model_1 extract]` → draft_concepts | `extractConcepts('draft')` in `server/pipeline.ts` |
| 3 | `[model_2 translate]` → concept_vectors | `embed()` in `server/embed.ts` |
| 3 | `[tool_1 match]` → candidate_facts | `matchFacts()` in `server/match.ts` |
| 3 | `[tool_3 select]` → highlight_spans | `selectHighlightSpans()` in `shared/tools.ts`; `POST /api/analyze`; `analyze()` in App |
| 4 | `[human select]` → clicked_span | click handler in `client/src/components/DraftEditor.tsx` |
| 4 | `[model_1 generate]~` → card_explanation | `generateExplanation()` in `server/pipeline.ts`; `POST /api/explain` |
| 4 | `[tool_3 compose]` → highlight_card | `composeHighlightCard()` in `shared/tools.ts`; `explain()` in App |
| 5 | `[human specify]` → query | `client/src/components/ChatPanel.tsx` |
| 5 | `[model_1 extract]` → query_concepts | `extractConcepts('query')` in `server/pipeline.ts` |
| 5 | `[model_2 translate]` → query_vectors | `embed()` in `server/embed.ts` |
| 5 | `[tool_1 match]` → query_facts | `matchFacts()` in `server/match.ts` |
| 5 | `[model_1 generate]~` → query_answer | `generateAnswer()` + `validateCitations()`; `POST /api/ask` |
| 5 | `[tool_3 compose]` → query_cards | `composeQueryCards()` in `shared/tools.ts`; `ask()` in App |
| 5 | `[tool_3 match]` → text_card_links | `linkAnswerToCards()` in `shared/tools.ts` |
| 6 | `[human select]` → chosen_highlight_card + chosen_query_card | checkboxes / drag in `CardsTray.tsx`, drop in `CanvasView.tsx` |
| 6 | `[tool_3 compose]` → canvas_2 | `addCardsToCanvas()` in `shared/tools.ts` |
| 6 | `[tool_1 match]` → related_edges | `matchRelatedEdges()` in `shared/tools.ts` |
| 6 | `[tool_3 compose]` → canvas_3 | `composeCanvasEdges()` in `shared/tools.ts`; `addToCanvas()` in App |
| 7 | `[human select]` → gold_node | `onNodeClick` in `CanvasView.tsx` |
| 7 | `[tool_3 match]` → origin_span | `locateOriginSpan()` in `shared/tools.ts`; flash in `DraftEditor.tsx` |
| 8 | `[human select]` → silver_node | `onNodeClick` in `CanvasView.tsx` |
| 8 | `[tool_3 match]` → query_turn | `findQueryTurn()` in `shared/tools.ts`; flash in `ChatPanel.tsx` |
| 9 | `[human modify]` draft_1 → draft_2 | `onDraftChange()` in App (spans follow the edit via `shiftSpans()`) |
| 9 | `[tool_2 compose]` → semantic_frame_2 | `composeSemanticFrame()` (same memo as process 2) |

All model_1 calls go through one function, `callModel()` in `server/model.ts`, which runs
`claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from the environment.
See `PLAN.md` for the representation table and `NOTES.md` for decisions the design left open.
