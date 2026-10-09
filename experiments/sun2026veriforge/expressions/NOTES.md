# NOTES — decisions the design did not determine

The design gave only nine expressions: no goal, no description, no process names or descriptions, no representation
descriptions, no references and no images. Everything below was my choice.

## Interpretation

- **What the system is for.** From the identifiers (source documents, knowledge graph, draft, highlight spans, query
  answers, canvas) I read it as a writing assistant that grounds a draft in a knowledge graph built from the writer's
  sources. The domain is open, not fixed.
- **How the processes come together.** One page; each process is a different interaction in it. Process 1 runs first
  (sources → graph); processes 3/4 are draft-side, 5 is chat-side, 6–8 are on the canvas, and 2/9 run in the background.
- **gold / silver nodes.** The design names them only as `gold_node` (process 7, links back to the draft) and
  `silver_node` (process 8, links back to the query). I made gold = node from a highlight card, silver = node from a
  query card, and colored them gold and silver.
- **Process 6 selection.** The design selects a highlight card *and* a query card together. I let the writer select any
  number of cards (of either kind) with checkboxes and add them together, or drag one card or the current selection.
  The compose → match → compose steps run on every add, and again on every removal.
- **related_edges.** For every pair of canvas nodes: a shared entity, or a direct KG relation between their entities
  (solid edge, labelled with the predicate), or else a two-hop path (dashed animated edge, "via X"). Edges are recomputed
  for the whole canvas each time.
- **semantic_frame contents.** `{focus, keyTerms, canvasEntities, canvasRelations, wordCount}`. focus = the draft's first
  sentence; keyTerms = 8 most frequent non-stopwords; canvas parts = titles of canvas nodes and their edges. Shown as
  chips under the draft. It goes into the concept-extraction prompts (process 3 and 5), which is the only place the
  design feeds it to a model.
- **Triggers.** Process 1: "Build knowledge graph" button (a rebuild replaces the graph and clears highlights).
  Process 3: automatically 2.5 s after typing stops (Auto-check toggle, on by default) plus a "Check draft" button.
  Process 4: clicking inside a highlighted phrase (clicking a phrase that already has a card focuses that card).
  Process 5: submitting a question. Processes 2/9: every draft or canvas change. Processes 7/8: clicking a node.
- **Process 9.** The design does not say whether editing re-runs process 3. Because process 3 continues from `draft`,
  the auto-check re-runs it after edits. While typing, existing highlights shift with the text (`shiftSpans`); spans the
  edit touches are dropped until the next check.
- **Process 7 when the draft changed.** origin_span is found by re-locating the card's phrase nearest to its original
  offset; if it is gone, a message says so.
- **Versions.** Draft and canvas versions are not kept (no step compares or reverts them); only the current version is stored.

## Data formats

- Entities `{id,name,type,description,aliases,sourceDocIds}`; relations `{id,source,target,predicate,evidence,sourceDocId}`.
  Entities merged by normalized name or alias (lowercase, strip articles/punctuation); duplicate relations dropped;
  relation endpoints not listed as entities are added as type `concept`.
- Concepts `{mention, concept}`. Draft mentions must appear in the draft (checked in code, not only in the prompt).
- Facts `{id: "F#", mention, entityId, entityName, entityType, description, statements[], relationIds[], score, sourceDocIds}`,
  one fact per (mention, matched entity), with up to 8 relation statements.
- Matching: cosine similarity between the concept's canonical name and `name. aliases. description` of each entity;
  threshold 0.55 (MiniLM) or 0.45 (fallback); top 2 entities per draft concept, top 3 per query concept; an exact name or
  alias match scores 1.
- Query cards: one per matched entity. text_card_links: `{cardId,start,end}` for `[F#]` citation markers and for
  occurrences of the card's entity name or mention in the answer. Citations to ids that weren't retrieved are removed.
- Long documents are split into ≈8000-character chunks for extraction.

## Model steps and prompts

- **model_1** = Claude via the local CLI: `claude -p --output-format json --json-schema <schema> --system-prompt <…>
  --tools "" --no-session-persistence --model haiku`, prompt on stdin, `CLAUDECODE` removed, cwd = OS temp dir, run as a
  detached process group, max 4 concurrent calls, 180 s timeout. The output is read from `structured_output`, falling back to
  the first JSON object in `result`. One function: `callModel()` in `server/model.ts`. I chose Haiku for speed (calls take
  4–8 s); `SYSTEMX_MODEL` changes it.
- Prompts (in `server/pipeline.ts`), one per operation:
  - domain extraction: entities of common kinds + subject–predicate–object relations with a ≤25-word verbatim evidence quote.
  - concept extraction (draft / query): exact-substring mention + canonical name, preferring knowledge-graph vocabulary
    (up to 300 entity names are put in the prompt) and the semantic frame; at most 25 / 8 concepts.
  - card explanation: 2–4 sentences on whether the KG supports, contradicts or adds to the phrase; uses only the given
    facts; does not mention fact ids.
  - query answer: under 150 words, only the retrieved facts, `[F#]` citations, says when the facts don't answer it.
- **model_2 (translate → vectors) does not use the Claude CLI.** The CLI cannot return embeddings, so model_2 is a local
  sentence-embedding model (`Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`) behind `embed()` in
  `server/embed.ts`. If the model cannot load, it falls back to a deterministic hashed character-trigram vectorizer.
  This departs from the brief's "every model step through the Claude CLI"; I chose real embeddings over asking an LLM to
  make up vectors.
- The knowledge-graph entity vectors that `tool_1 match` compares against are computed once per graph build, with the
  same `embed()`, and cached as the tool's retrieval index.
- Generative steps (`~`): a loading placeholder card or chat turn while the call runs; "Regenerate" on highlight cards;
  errors shown inline. The card is shown for review once generated, and the writer decides whether it goes on the canvas.
  No streaming (CLI JSON mode returns one result).

## Stack, persistence, layout, styling

- Node 20 + TypeScript; Express backend run with `tsx`; React 19 + Vite frontend; `@xyflow/react` for the canvas;
  `d3-force` + SVG for the knowledge-graph view; Vitest for the deterministic tools (`shared/tools.test.ts`).
- Persistence: knowledge graph and sources in `data/kg.json` / `data/sources.json`; draft, highlights, cards, canvas and
  chat in browser `localStorage`. Single user, no accounts.
- Layout: top bar (graph size and models in use); three columns — Draft with the semantic frame below (left), Canvas
  above a two-column Cards tray, gold vs silver (middle), and tabs for Ask / Sources & graph (right).
- Draft editor: a plain textarea over a mirrored backdrop that draws the highlights (yellow with a gold underline), so
  editing stays native. A click is matched to a span by caret position. The origin span is selected and flashed.
- Styling: warm light-grey background, white panels, serif draft text, gold `#c99a06` and silver `#8a94a3` for the two
  card kinds, blue accent. KG nodes colored by entity type, nodes on the canvas ringed in gold.
- Added an "Load example sources" button with two short made-up texts about coral reefs, so the app can be tried
  straight away. It is example content, not a design step.

## Verification

- `npm run typecheck` and `npm run build` pass; `npm test` passes 7 tests.
- I walked through all nine processes in a headless browser with the real CLI: building the graph (45 entities,
  37 relations, ~19 s), auto-check highlights, a highlight card, a cited answer with linked cards, adding gold and silver
  cards to the canvas (edges "breeds" and "via Assisted evolution"), jumping from a gold node to the draft after an edit,
  jumping from a silver node to the chat turn, and the semantic frame updating. Every transformation was reachable.

## Did the design remind me of a published system?

Not of one specific system I can name with confidence. The parts look like several research prototypes I know of:
knowledge-graph-grounded writing support, RAG chat with citations linked to the text, and canvases where cards from
reading or chatting are arranged (e.g. Graphologue / Sensecape-style node-link views of LLM output). I can't match
"semantic frame" or the gold/silver node split to a particular paper, so I didn't try to copy one.

Choices that came from general familiarity with such systems rather than from the design:
- `[F#]` inline citation markers in answers, and linking answer phrases to cards by entity name;
- a draggable node-link canvas (React Flow) with labelled edges, dashed for indirect relations;
- color-coding the two card kinds and showing the knowledge graph as a force-directed view;
- extracting subject–predicate–object triples with evidence quotes to build the graph.

The gold/silver naming, the semantic frame being made from both draft and canvas, and the jump-back behaviour
of nodes come directly from the design's identifiers and expressions.
