# System X — grounded writing workspace

An implementation of the Human-AI grammar design in `design.json`. You add source documents,
which are turned into a knowledge graph. You then write a draft, ground it against the graph, get
suggestions for grounded passages, ask questions of the sources, and collect what you find in a
personal **writing map**.

## Run

Requirements: Node 20+, and the Claude Code CLI (`claude`) installed and logged in.

```bash
npm install
npm run dev        # API on :8787 and Vite on http://localhost:5173
# or
npm start          # build, then serve everything on http://localhost:8787
npm test           # unit tests for the tools plus a UI smoke test
npm run typecheck
```

Every model step runs through `callModel()` in `server/model.ts`. It starts
`claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from the
environment. To use a different provider, replace that one function. Optional env vars:
`MODEL_1` and `MODEL_2` (model per role) and `MODEL_TIMEOUT_MS`.

Walkthrough: **Load example → Build knowledge graph → Ground draft → click a yellow passage →
📌 Select for map → Ask the sources → 📌 a fact → Add to map → click a map node.**

## Design → code

| Process | Transformation | Code |
| --- | --- | --- |
| P1 | `[model_1 extract]` r1* → r2* + r3* | `extractEntitiesAndRelations` — server/pipelines.ts |
| P1 | `[tool_1 compose]` → r4 | `composeKnowledgeGraph` — src/shared/tools.ts |
| P2 | `[tool_2 compose]` r5 + r6 → r7 | `composeDraftContext`, debounced effect in src/App.tsx |
| P3 | `[model_1 extract]` → r8* | `extractDraftClaims` — server/pipelines.ts |
| P3 | `[model_2 translate]` → r9* | `translateToVectors` — server/pipelines.ts |
| P3 | `[tool_1 match]` → r10* | `matchVectorsToGraph` — tools.ts |
| P3 | `[tool_3 select]` → r11* | `selectGroundedSpans` — tools.ts |
| P4 | `[human select]` → r12 | clicking a highlighted span — src/components/DraftEditor.tsx |
| P4 | `[model_1 generate]~` → r13 | `generateSuggestion` — server/pipelines.ts |
| P4 | `[tool_3 compose]` → r14 | `composeSuggestionCard` — tools.ts |
| P5 | `[human specify]` → r15 | question form — src/components/AskPanel.tsx |
| P5 | `[model_1 extract]` → r16* | `extractQuestionTerms` — server/pipelines.ts |
| P5 | `[model_2 translate]` → r17* | `translateToVectors` — server/pipelines.ts |
| P5 | `[tool_1 match]` → r18* | `matchVectorsToFacts` — tools.ts |
| P5 | `[model_1 generate]~` → r19 | `generateAnswer` — server/pipelines.ts |
| P5 | `[tool_3 compose]` → r20* | `composeAnswerFacts` — tools.ts |
| P5 | `[tool_3 match]` → r21* | `matchFactSources` — tools.ts |
| P6 | `[human select]` → r22 + r23 | 📌 toggles in SuggestionsPanel/AskPanel, then “Add to map” in WritingMapPanel |
| P6 | `[tool_3 compose]` → r6_2 | `addPinsToMap` — tools.ts |
| P6 | `[tool_1 match]` → r24 | `matchMapToGraph` — tools.ts |
| P6 | `[tool_3 compose]` → r6_3 | `linkMap` — tools.ts |
| P7 | `[human select]` → r25 | clicking a map node — src/components/WritingMapPanel.tsx |
| P7 | `[tool_3 match]` → r26 | `matchNodeSpans(draft, node)` — App.tsx / tools.ts |
| P8 | `[human select]` → r27 | clicking a map node — WritingMapPanel.tsx |
| P8 | `[tool_3 match]` → r28 | `matchNodeSpans(answer, node)` — App.tsx / tools.ts |
| P9 | `[human modify]` r5_1 → r5_2 | editing the draft in Write mode — DraftEditor.tsx |
| P9 | `[tool_2 compose]` → r7_2 | `composeDraftContext` (same debounced effect) |

The representation types are in `src/shared/types.ts`, each commented with its identifier. See
`PLAN.md` for the full interpretation and `NOTES.md` for every choice the design left open.
