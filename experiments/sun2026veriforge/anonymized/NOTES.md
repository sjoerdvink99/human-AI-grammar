# NOTES — decisions the design did not determine

The design only gives structure: nine expressions over identifiers r1…r28. It has no goal,
description, process names, representation descriptions, references or images. So **everything
about meaning** was my decision, and the main one comes first.

## 1. Interpretation of the identifiers

| id | design type | what I decided it is |
| --- | --- | --- |
| r1 | artifact language* | source documents the user pastes or uploads |
| r2, r3 | artifact record* | entities and relations extracted per document (with evidence quotes) |
| r4 | artifact graph | knowledge graph merged from r2/r3 |
| r5 | artifact language | the user's draft (versioned on edit) |
| r6 | artifact graph | the user's own **writing map**, which starts empty and grows through P6 |
| r7 | artifact record | draft context: paragraphs with offsets, word count, map concepts, draft version |
| r8 | artifact record* | claims/concepts quoted verbatim from the draft |
| r9, r17 | artifact numeric* | per-item relevance vectors over KG nodes |
| r10 | artifact record* | groundings: claim → matched KG nodes (scores) + related edges |
| r11 | selection language* | draft spans of grounded claims (highlights) |
| r12 | selection language | the span the user clicks |
| r13 | artifact language | generated suggestion: a grounded revision/extension of that span |
| r14 | artifact record | suggestion card (span, suggestion, KG node/edge ids) |
| r15 | instruction language | the user's question to the sources |
| r16 | artifact record* | lookup concepts extracted from the question |
| r18 | artifact record* | retrieved KG facts, numbered F1… |
| r19 | artifact language | answer citing facts as [F#] |
| r20 | artifact record* | fact cards for the facts the answer cites |
| r21 | artifact record* | source document + evidence snippet per fact |
| r22, r23 | selection record | the suggestion card and answer fact chosen for the map |
| r24 | artifact graph | KG sub-graph that connects map nodes (direct edges and 2-hop paths) |
| r25, r27 | selection record | the map node the user clicks |
| r26, r28 | selection language | mentions of that node in the draft / in the answer |

Actor roles: `model_1` = generative LLM; `model_2` = a separate "vectorising" role; `tool_1` =
knowledge-graph tool (compose, match); `tool_2` = context builder; `tool_3` = text/span and card tool.

The resulting app is a "write against your sources" workspace. I chose writing over other readings
(for example health-information seeking or a literature review) because r5 is a human-modified
language artifact that is central to many processes and is re-composed after edits (P9).

## 2. Process triggers (the design has no descriptions)

- P1: "Build knowledge graph" button. Rebuilding clears groundings and answers that refer to the old graph.
- P2/P9: automatic, debounced 400 ms after any draft or map change. Each settled edit bumps the
  draft version (r5_1 → r5_2) and recomposes r7.
- P3: "Ground draft" button. After later edits, `tool_3 select` re-locates the existing groundings
  in the edited draft and the UI says the grounding is stale. It does not re-run the models automatically.
- P4: clicking a highlighted span immediately generates a suggestion. "Regenerate" repeats it,
  and earlier cards stay in the list (newest first, up to 30).
- P5: submitting the question (Enter or "Ask"). "Regenerate" re-asks the same question.
- P6: 📌 toggles select at most one suggestion card (r22) and one answer fact (r23). "Add to map"
  runs compose → match → compose. Either pin alone is enough. If both are pinned, they get a
  "pinned together" edge.
- P7 and P8 share one interaction: clicking a map node highlights its mentions in the draft (green)
  and in the current answer (green), and highlights its KG nodes in the KG view.

## 3. Model steps and prompts

- Provider: local Claude Code CLI via `callModel()` (server/model.ts): `claude -p --output-format
  json --tools "" --json-schema <schema> --system-prompt <role prompt>`. The prompt goes in on
  stdin, `CLAUDECODE` is unset, and the result is read from `structured_output` (with a fallback
  that parses JSON from `result`). Default model, overridable per role with `MODEL_1`/`MODEL_2`.
  Timeout 180 s.
- **model_2 / numeric vectors.** No embedding API is available, and the CLI can't produce real
  embeddings. So `translate` asks the model for a sparse relevance vector over the KG nodes
  (index → score 0–1, omitting irrelevant nodes). The tool expands this into a dense vector aligned
  with `knowledgeGraph.nodes`. KG nodes are sent in batches of 100, with 3 calls running at once.
  With a real embedding provider, `translateToVectors` + `tool_1 match` would become cosine
  similarity. Only that function would change.
- Prompts (full text in server/pipelines.ts):
  - P1 extract: canonical singular entity names, short lowercase verb-phrase relation labels,
    verbatim evidence, no outside knowledge. One call per document, at most 3 at once.
  - P3 extract: at most 15 non-overlapping items quoted verbatim, each typed claim/concept, biased
    towards KG topics and map concepts. Input: paragraphs from r7, map concepts, and up to 150 KG node names.
  - P4 generate: a 1–3 sentence revision/extension of the span that fixes contradictions, uses only
    the matched facts, and keeps the writer's voice.
  - P5 extract: 1–6 concept phrases, resolving references through the draft context.
  - P5 generate: answer only from the numbered facts, cite them as [F#], under 150 words, and say
    so when the facts don't answer the question.
- Validation of generated or extracted output:
  - P1 relation evidence must appear in the document, otherwise it is dropped.
  - P3 quotes must be found in the draft (exact, then case-insensitive, then ignoring whitespace),
    otherwise they are discarded.
  - Vector indices are bounds-checked and scores clamped to 0–1.
  - An empty suggestion is an error.
  - Answer citations to fact ids that were not provided are removed.
- Matching thresholds (tool_1): score ≥ 0.5, top 4 nodes per claim. Edges among the matched nodes,
  padded with up to 3 edges of the best node. For questions: at most 8 nodes and 12 edges. An edge
  scores the mean of its two endpoints if both matched, or 0.8 × the matched endpoint.

## 4. Data formats

- KG merge: entities are merged by a normalised name (lowercase, punctuation stripped, trailing
  "s" removed). Node id `n:<slug>`, edge id `e:<src>|<label>|<tgt>`. Relations whose endpoints
  weren't extracted as entities still create nodes, typed "concept".
- All types are in src/shared/types.ts and named after the identifier (e.g. r10 → `Grounding`).
- Writing-map versions: one `version` counter. Each P6 run increments it twice (r6_2, r6_3).
  Earlier versions are not kept, because no step compares or reverts them.
- Map linking (r24 → r6_3): map nodes are linked when they share a KG node ("both about X"), when
  a KG edge connects them (edge label), or through a 2-hop path ("via X"). KG-derived links are
  drawn dashed.
- Node mentions (P7/P8): case-insensitive search for the node's anchors. For a suggestion node the
  anchors are its span text plus its KG node names. For a fact node they are its KG node names.
  Matching is substring-based, so "coral" also matches inside "corals".

## 5. Layout, styling and interaction

- Three columns: **Sources + KG view** (340 px) | **Draft** (flexible) | **Writing map** on top
  with **Suggestions / Ask the sources** tabs below (460 px).
- The draft has Write mode (plain textarea) and Review mode (read-only text with highlights).
  Grounding a draft or clicking a map node switches to Review. Yellow = grounded span (darker when
  selected). Green = mentions of the selected map node.
- Graphs: static d3-force layout drawn as SVG, no dragging or zoom. KG nodes are coloured by
  entity type. In dense graphs (over 40 nodes) labels show only for hubs and highlighted nodes.
  Map nodes are coloured by kind and show edge labels.
- Numeric values (r9/r17 scores) are shown as small bars next to matched nodes and retrieved facts.
- Loading states: buttons change label ("Grounding…", "Answering…"), and a pulsing card appears
  while a suggestion is generated. Errors show as red banners or cards.
- Sources: paste text, upload .txt/.md, or "Load example". The example content (three short coral
  reef texts and a draft with deliberate errors) was written for this prototype.
- "Copy" on suggestion cards. There is no automatic "apply to draft", because the design has no
  model→draft step. The human edits the draft (P9). I removed a "remove map node" control I had
  started, because the design has no step for it.
- Persistence: the whole workspace is saved in `localStorage`, with a "Reset workspace" button.
  The server is stateless.

## 6. Libraries and stack

Vite + React 19 + TypeScript. Express 5 + `tsx` for the API. `d3-force` for layout. Vitest (+
jsdom 24 and Testing Library) for tests. `concurrently` for `npm run dev`. No CSS framework.

## 7. Did the design remind me of a specific published system?

Not one I could name with confidence. The structure has these ingredients:

- an LLM extracts entities and relations from documents into a knowledge graph;
- the LLM's own text or the user's text is split into items, embedded, and linked to the graph;
- a question-answering branch retrieves graph facts;
- an interactive graph the user curates, where clicking a node finds it in the text.

That combination is reminiscent of KG-augmented LLM interfaces from the visualisation/HCI
literature, for example **KNowNEt** (health information seeking with a knowledge graph, which
verifies LLM answers against KG triples) and **Graphologue** (turning LLM text into interactive
node-link diagrams). It is also close to the general **GraphRAG** pattern. I did not consult or
recall details of any of them while building, and I am not sure the design comes from any of them.

What came from that general background knowledge rather than from the design:

- reading `[model_2 translate] → numeric*` followed by `[tool_1 match]` as an embedding plus
  similarity-matching (entity-linking) step;
- reading `[model_1 extract] → record* + record*` followed by `[tool_1 compose] → graph` as
  LLM-based entity/relation extraction into a KG;
- citing numbered facts as [F#] in answers and showing source snippets for each fact (a common RAG
  convention).

The writing-assistant framing, the writing map, all prompts, the layout and the interaction
details are my own choices, made to fit the expressions.
