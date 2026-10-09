# System X — knowledge-aware fiction writing

A mixed-initiative writing environment built from the Human-AI grammar design in [`design.json`](design.json).
Upload domain reference texts. They become a source-linked knowledge graph. As you write, the app underlines phrases that may be domain-knowledge gaps. Click one to see a Knowledge Card that pairs an explanation with exact source passages. You can also ask questions in the Query Panel, collect cards on a spatial Knowledge Canvas, and jump from a card back to where it came from. The app never writes story prose.

## Run

Requirements: Node 20+, and the [Claude Code CLI](https://claude.com/claude-code) (`claude`) installed and logged in. No API key is needed.

```bash
npm install
npm run dev          # API on :8787, UI on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:8787
```

Try it: open **Sources**, upload `samples/sailing-navigation.md`, and wait for "Knowledge graph ready". Then paste `samples/draft.txt` into the Draft and stop typing for 5 seconds.

Environment variables: `CLAUDE_MODEL` (default `sonnet`), `CLAUDE_TIMEOUT_MS`, `INGEST_CONCURRENCY` (default 4), `PORT` (default 8787).

Checks: `npm run typecheck`, `npm test` (unit tests for the deterministic tools), `npm run build`.
To run the browser walkthrough of all nine processes against a running server, use `NODE_PATH=<dir containing playwright> node tests/e2e/walkthrough.cjs samples/draft.txt http://localhost:8787`.

## Architecture

| Actor in design | Implementation |
| --- | --- |
| model_1 (language model) | `server/model.ts#callModel` spawns `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` unset. Swap this one function to change the provider. |
| model_2 (embedding model) | `server/embed.ts#embed`: a local hashed word + character-trigram embedding (512-d). Swap this one function for a real embedding model. |
| tool_1 (graph database) | `server/graphdb.ts#GraphDB`: an in-process graph persisted to `data/graph.json` |
| tool_2 (async context manager) | `server/context.ts#composeSemanticFrame`, triggered by the client 1.5 s after draft edits and after canvas changes |
| tool_3 (source alignment & presentation) | `server/align.ts`, `web/src/align.ts`, `web/src/canvasOps.ts` |

## Design → code map

| Process | Transformation | Code |
| --- | --- | --- |
| 1 Build Domain Knowledge Graph | `[model_1 extract]` source_documents → domain_entities + domain_relations | `server/ingest.ts#extractEntities` (passages from `splitPassages`) |
| | `[tool_1 compose]` → knowledge_graph | `server/graphdb.ts#GraphDB.compose` |
| 2 Maintain Writing Context | `[tool_2 compose]` draft + canvas → semantic_frame | `server/context.ts#composeSemanticFrame`; trigger in `web/src/App.tsx` (frame effect) |
| 3 Proactively Highlight Knowledge Gaps | `[model_1 extract]` → draft_concepts | `server/highlight.ts#extractDraftConcepts` |
| | `[model_2 translate]` → concept_vectors | `server/embed.ts#embed` (called in `highlightGaps`) |
| | `[tool_1 match]` → candidate_facts | `server/graphdb.ts#GraphDB.match` (1 hop) |
| | `[tool_3 select]` → highlight_spans | `server/align.ts#selectHighlightSpans`; 5 s typing-pause trigger in `App.tsx`; rendered in `web/src/DraftEditor.tsx` |
| 4 Inspect Highlighted Knowledge | `[human select]` → clicked_span | click handler in `DraftEditor.tsx` → `App.tsx#onClickSpan` |
| | `[model_1 generate]~` → card_explanation | `server/card.ts#generateCardExplanation` (loading state, retry, "Regenerate explanation") |
| | `[tool_3 compose]` → highlight_card | `server/align.ts#composeHighlightCard`; shown by `web/src/KnowledgeCard.tsx` |
| 5 Query Domain Knowledge | `[human specify]` → query | `web/src/QueryPanel.tsx` form |
| | `[model_1 extract]` → query_concepts | `server/query.ts#extractQueryConcepts` |
| | `[model_2 translate]` → query_vectors | `server/embed.ts#embed` |
| | `[tool_1 match]` → query_facts (multi-hop) | `GraphDB.match` (2 hops) |
| | `[model_1 generate]~` → query_answer | `server/query.ts#generateQueryAnswer` |
| | `[tool_3 compose]` → query_cards | `server/align.ts#composeQueryCards` |
| | `[tool_3 match]` → text_card_links | `server/align.ts#linkAnswerToCards`; colors rendered in `QueryPanel.tsx#AnswerText` |
| 6 Curate Knowledge on Canvas | `[human select]` → chosen_highlight_card / chosen_query_card | "Add to canvas" in `KnowledgeCard.tsx` → `App.tsx#addToCanvas` |
| | `[tool_3 compose]` → canvas_2 (gold/silver node) | `web/src/canvasOps.ts#addCardToCanvas` |
| | `[tool_1 match]` → related_edges | `GraphDB.relateNodes` via `POST /api/canvas/relate` |
| | `[tool_3 compose]` → canvas_3 | `web/src/canvasOps.ts#mergeRelatedEdges`; view in `web/src/KnowledgeCanvas.tsx` |
| 7 Navigate to Highlight Source | `[human select]` gold_node, `[tool_3 match]` → origin_span | `App.tsx#onNodeClick` → `web/src/align.ts#locateOriginSpan`; flashed and scrolled in `DraftEditor.tsx` |
| 8 Navigate to Query Source | `[human select]` silver_node, `[tool_3 match]` → query_turn | `App.tsx#onNodeClick` → `QueryPanel.tsx` (scroll + flash on `focusTurn`) |
| 9 Integrate Knowledge into Narrative | `[human modify]` draft_1 → draft_2 | `App.tsx#onDraftChange` (the textarea; no AI prose anywhere) |
| | `[tool_2 compose]` → semantic_frame_2 | same frame effect as process 2 |
