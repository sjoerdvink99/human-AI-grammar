# PLAN — System X

The design has no goal, no descriptions, no representation descriptions, no references and no
images. Only the structure of nine processes is given. The plan below infers the meaning of each
identifier from roles, media, actors and data flow. Following the experiment's instructions, the
recommended defaults are taken without waiting for confirmation.

## Interpretation

A **knowledge-graph–grounded writing workspace**:

- A collection of source documents is turned into a knowledge graph (P1).
- The user writes a draft (r5). The draft, together with the user's personal **writing map**
  (r6, a graph the user builds), is condensed into a draft context record (r7) (P2, re-run after
  edits in P9).
- The system grounds the draft against the knowledge graph: it extracts claims, scores them
  against KG nodes, matches them and highlights the grounded spans in the draft (P3).
- The user selects a highlighted span and gets a generated, KG-grounded suggestion, composed into
  a suggestion card (P4).
- The user can ask a question; it is answered from KG facts, with fact cards and sources (P5).
- The user pins a suggestion card and/or an answer fact to the writing map; the map is then linked
  through the KG (P6).
- Selecting a map node highlights where it appears in the draft (P7) or in the answer (P8).

Actors: `model_1` = LLM (extract, generate), `model_2` = a separate "embedding-like" model role
that translates text items into numeric relevance vectors over KG nodes, `tool_1` = KG tool
(compose graph, match vectors/nodes), `tool_2` = context builder, `tool_3` = text/UI tool
(span selection, card composition, span matching, map merging).

## Stack (repository was empty)

- Vite + React + TypeScript frontend, Express + TypeScript backend (run with `tsx`).
- Every model step goes through `callModel()` in `server/model.ts`, which runs
  `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from the
  environment. Swapping providers = replacing that one function.
- Deterministic tools in `src/shared/tools.ts`, shared by server and client; tested with Vitest.
- Persistence: browser `localStorage` (single-user workspace).

## Representations

| id | type (code name) | contents | file |
| --- | --- | --- | --- |
| r1 | `SourceDocument[]` (`sourceDocuments`) | title + text of each pasted/uploaded document | src/shared/types.ts |
| r2 | `Entity[]` (`entities`) | name, type, description, source doc | types.ts |
| r3 | `Relation[]` (`relations`) | source name, label, target name, evidence quote, source doc | types.ts |
| r4 | `KnowledgeGraph` (`knowledgeGraph`) | merged nodes (with source docs) and labelled edges | types.ts |
| r5 | `string` (`draft`) | the user's draft text; versioned on edit (r5_1 → r5_2) | App state |
| r6 | `WritingMap` (`writingMap`) | user's graph of pinned items + links; versions r6_1 → r6_2 → r6_3 | types.ts |
| r7 | `DraftContext` (`draftContext`) | paragraphs with offsets, word count, map concepts | types.ts |
| r8 | `DraftClaim[]` (`draftClaims`) | exact-quote claims/concepts extracted from the draft | types.ts |
| r9 | `number[][]` (`claimVectors`) | per-claim relevance vector over KG nodes | types.ts |
| r10 | `Grounding[]` (`groundings`) | per claim: matched KG nodes (score) and edges | types.ts |
| r11 | `TextSpan[]` (`groundedSpans`) | character spans in the draft for grounded claims | types.ts |
| r12 | `TextSpan` (`selectedSpan`) | the span the user clicked | App state |
| r13 | `string` (`suggestion`) | generated grounded elaboration/revision for the span | types.ts |
| r14 | `SuggestionCard` (`suggestionCard`) | span + suggestion + KG nodes/edges used | types.ts |
| r15 | `string` (`question`) | user's question/request | App state |
| r16 | `QueryTerm[]` (`questionTerms`) | key concepts extracted from the question | types.ts |
| r17 | `number[][]` (`questionVectors`) | relevance vectors over KG nodes | types.ts |
| r18 | `KGFact[]` (`retrievedFacts`) | matched KG nodes/edges as facts with ids | types.ts |
| r19 | `string` (`answer`) | generated answer citing facts as [F1] | types.ts |
| r20 | `AnswerFact[]` (`answerFacts`) | cards for facts cited in the answer | types.ts |
| r21 | `FactSource[]` (`answerSources`) | per fact: source document and evidence snippet | types.ts |
| r22 | `SuggestionCard` selection (`pinnedSuggestion`) | chosen suggestion card | App state |
| r23 | `AnswerFact` selection (`pinnedFact`) | chosen answer fact | App state |
| r24 | `KnowledgeGraph` (`mapLinks`) | KG sub-graph connecting map nodes | types.ts |
| r25 / r27 | `MapNode` selection (`selectedMapNode`) | node clicked in the writing map | App state |
| r26 | `TextSpan[]` (`draftNodeSpans`) | draft spans mentioning the selected node | App state |
| r28 | `TextSpan[]` (`answerNodeSpans`) | answer spans mentioning the selected node | App state |

## Transformations

| process | step | function / component | file |
| --- | --- | --- | --- |
| P1 | model_1 extract | `extractEntitiesAndRelations` | server/pipelines.ts |
| P1 | tool_1 compose | `composeKnowledgeGraph` | src/shared/tools.ts |
| P2 | tool_2 compose | `composeDraftContext` (auto on draft/map change) | tools.ts, App.tsx |
| P3 | model_1 extract | `extractDraftClaims` | pipelines.ts |
| P3 | model_2 translate | `translateToVectors` | pipelines.ts |
| P3 | tool_1 match | `matchVectorsToGraph` | tools.ts |
| P3 | tool_3 select | `selectGroundedSpans` | tools.ts |
| P4 | human select | click a highlighted span | DraftEditor.tsx |
| P4 | model_1 generate ~ | `generateSuggestion` | pipelines.ts |
| P4 | tool_3 compose | `composeSuggestionCard` | tools.ts |
| P5 | human specify | question form | AskPanel.tsx |
| P5 | model_1 extract | `extractQuestionTerms` | pipelines.ts |
| P5 | model_2 translate | `translateToVectors` | pipelines.ts |
| P5 | tool_1 match | `matchVectorsToFacts` | tools.ts |
| P5 | model_1 generate ~ | `generateAnswer` | pipelines.ts |
| P5 | tool_3 compose | `composeAnswerFacts` | tools.ts |
| P5 | tool_3 match | `matchFactSources` | tools.ts |
| P6 | human select | "pin" toggles on suggestion card / answer fact + "Add to map" | SuggestionsPanel, AskPanel, App |
| P6 | tool_3 compose | `addPinsToMap` | tools.ts |
| P6 | tool_1 match | `matchMapToGraph` | tools.ts |
| P6 | tool_3 compose | `linkMap` | tools.ts |
| P7 | human select | click map node | WritingMap.tsx |
| P7 | tool_3 match | `matchNodeSpans` (draft) | tools.ts |
| P8 | human select | click map node | WritingMap.tsx |
| P8 | tool_3 match | `matchNodeSpans` (answer) | tools.ts |
| P9 | human modify | edit draft | DraftEditor.tsx |
| P9 | tool_2 compose | `composeDraftContext` | tools.ts |

## Images

None in the design.

## Open choices and defaults taken

- Domain: general research writing from source documents; sample content (coral reef docs) included.
- Layout: three columns — Sources/KG | Draft | Writing map + Suggestions/Ask tabs.
- model_2 numeric vectors: relevance scores over KG nodes from the same CLI (no embedding API
  available); KG node list is batched in chunks of 100.
- Triggers: P1 on "Build knowledge graph"; P2/P9 automatically (debounced) on draft or map change;
  P3 on "Ground draft"; P4 on span click; P5 on question submit; P6 on "Add to map";
  P7/P8 on map node click.
- Persistence: localStorage. No auth.
