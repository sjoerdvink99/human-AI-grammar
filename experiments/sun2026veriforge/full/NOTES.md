# NOTES — decisions the design did not determine

The design (`design.json`) fixed the 9 processes, the representations and their roles/media, the actors (model_1 LLM, model_2 embedding model, tool_1 graph DB, tool_2 async context manager, tool_3 source alignment/presentation), the 5-second typing-pause trigger, the gold/silver node colors, and the "no AI-generated story prose" constraint. It had no references and no images. Everything below is my own choice.

## Stack and infrastructure
- **Languages/libraries:** TypeScript throughout. Node 20 + Express backend run with `tsx`. React 18 + Vite frontend. `@xyflow/react` (React Flow v13) for the Knowledge Canvas. `vitest` for unit tests. `concurrently` for `npm run dev`. No CSS framework; one hand-written stylesheet.
- **Model provider (model_1):** the Claude Code CLI. One function, `server/model.ts#callModel`, spawns `claude -p --output-format json --json-schema <schema> --tools "" --no-session-persistence --system-prompt …` with `CLAUDECODE` removed from the environment and the prompt on stdin. It uses the `structured_output` field and falls back to extracting JSON from `result`. The default model alias is `sonnet`, overridable with `CLAUDE_MODEL`. Timeout is 180 s.
- **Embedding model (model_2):** no embedding API was available, so `server/embed.ts#embed` is a local, deterministic 512-d hashed embedding (word hashes plus character trigrams, light stemming, L2-normalised). It is a stand-in that captures lexical similarity, not semantic similarity. Swapping it for a real embedding model only changes this one function.
- **Graph database (tool_1):** an in-process graph (entities, relations, passages, documents) persisted as JSON in `data/graph.json`. It is not Neo4j or a real graph DB.
- **Persistence of user work:** the draft, canvas and query history live in browser `localStorage` (single user, single document). The knowledge graph lives on the server.
- **Single-user server state:** the latest semantic frame is held in server memory.

## Data formats (shared/types.ts)
- **Source documents** are .txt / .md uploads or pasted text. PDF and EPUB are not supported. Documents are split into passages of about 2,500 characters on paragraph boundaries, splitting long paragraphs at sentences.
- **Entities:** `{name, type, description, evidence, passageId}`. **Relations:** `{source, target, label, evidence, passageId}`. Entities with the same normalised name (lowercased, punctuation stripped, trailing "s" removed) are merged across passages. A relation endpoint that is unknown creates a bare "concept" entity.
- **Exact source passages:** the model is asked for a verbatim evidence sentence. `exactQuote` checks that it really occurs in the passage. If not, it falls back to the passage sentence that mentions the entity, so every quote on a card is verbatim source text. "Full passage" on a card shows the whole stored passage.
- **Facts** are entity descriptions (hop 0) or relation triples rendered as "A label B" (hop ≥ 1). Each has an exact quote, a document title and a score.
- **Semantic frame** (tool_2, deterministic, no model): the last ~1,500 characters of the draft as a focus excerpt, the top 15 salient terms (frequency with a capitalisation bonus and a stop-list), the canvas topics, and the canvas relations as "A —label→ B". It is shown as chips in the header, with full details in a tooltip.
- **Highlight span:** `{start, end, text, concept, factIds}` as character offsets into the draft. **Knowledge card:** concept, explanation, up to 3 facts with quotes, entity keys, and an origin (a highlight with 40 characters of context on each side, or a query turn id). **Text-card link:** `{start, end, cardId, color}` over the answer text.

## Retrieval and matching logic
- `GraphDB.match` scores entities by cosine similarity, plus +0.5 for an exact normalised name match and +0.2 for containment, with a threshold of 0.32. It keeps the top 3 entities per concept and then walks relations: 1 hop for proactive highlighting, 2 hops for queries ("multi-hop"). The score decays by 0.8 per hop. A query keeps at most 24 facts.
- **tool_3 select (highlights):** a concept becomes a highlight only if its phrase occurs in the draft (the last occurrence, case-insensitive fallback) and it has at least one fact scoring ≥ 0.42. Overlapping spans are dropped. Concepts already on the canvas are **not** highlighted again (my reading of "gap"; the semantic frame carries the canvas topics).
- **tool_3 compose (query cards):** one card per query concept that has facts. The title is the best hop-0 entity name. The "explanation" is the text of up to 2 hop-0 fact statements, so query cards make no extra model call; the design has only one generate step in process 5. Card colors come from an 8-color palette.
- **tool_3 match (answer ↔ cards):** case-insensitive, whole-word matching (allowing plural endings) of each card's concept and entity names in the answer. Each occurrence gets the card's color. Hovering a link highlights its card and the reverse; clicking a link scrolls to the card.
- **tool_1 match on the canvas (related edges):** for each pair of nodes, in this order: (1) a direct graph relation between their entities, labelled with the relation and pointing in its direction; (2) shared entities ("both about X"); (3) a shared neighbour ("linked via X"); (4) embedding cosine > 0.5 ("similar topic"). Automatic edges are recomputed for all pairs each time a card is added. Users cannot draw edges by hand; the design has no such step.
- **tool_3 match (process 7):** the stored offsets are used if the text there still matches. Otherwise the app searches for context-before + phrase, then phrase + context-after, then the occurrence of the phrase nearest the original offset. If the phrase is gone, a toast says so.
- **Span re-anchoring:** while the author edits, existing highlights are re-anchored to the nearest occurrence of their text, and vanish if the text is gone. This is not a design step; it keeps process 3's output valid between scans.

## Triggers and timing
- **Process 3:** the scan runs 5 s after the last keystroke. The draft must be at least 20 characters and the graph must have entities. Before scanning, the frame is refreshed for exactly this draft. Results that arrive after further edits are re-anchored, not discarded.
- **Processes 2/9 (tool_2):** the frame is recomputed 1.5 s after a draft change or after a change to the canvas topology (node concepts or edges, not positions).
- **Process 6:** related edges are computed right after each "Add to canvas".
- **Process 1:** extraction runs as a background job with 4 concurrent model calls. The client polls every 1.5 s and shows a progress bar. Failed passages are counted and reported; the rest still go into the graph.

## Model prompts (system prompts in code)
- **Entity extraction** (`server/ingest.ts`): domain entities and relations a novelist might need. Only information from the passage. One-sentence descriptions. Verbatim evidence. Lowercase verb-phrase relation labels. At most 15 of each. JSON-schema output. Relations whose endpoints are not extracted entities are dropped.
- **Draft concepts** (`server/highlight.ts`): input is the semantic frame plus the last 4,000 characters of the draft. Output is `{phrase (verbatim, 1–6 words), concept, reason}`, at most 10, ignoring character names and everyday words. Phrases that do not occur in the draft are rejected in code.
- **Card explanation** (`server/card.ts`): 40–90 words, ONLY from the provided facts, focused on what a writer needs to depict the concept accurately. No story prose and no edit suggestions. Truncated to 120 words in code.
- **Query concepts** (`server/query.ts`): 1–6 noun phrases from the question, disambiguated with the semantic frame.
- **Query answer** (`server/query.ts`): conversational, 60–180 words, ONLY from the facts. It says what is missing when the facts do not cover the question, uses the facts' names for concepts (so that linking works), and cites no fact numbers. If retrieval finds nothing, a fixed message is returned without calling the model.

## Layout, styling and interaction
- **Three columns:** Draft (left, widest), Knowledge Canvas (middle), Query Panel (right). A top bar holds the title, the semantic-frame chips and a **Sources** button that opens a modal for upload/paste, graph statistics, progress and "Clear graph".
- **Draft editor:** a plain `<textarea>` over a mirrored backdrop that draws marks. Gap highlights are subtle dotted gold underlines. The origin span is a pulsing yellow highlight; the draft scrolls to it and selects it. The prose uses a serif font. A status line shows "Highlights update after a 5 s pause", "Looking for knowledge gaps…" and similar messages.
- **Knowledge Card (process 4):** a popover placed just under the clicked phrase. It shows a loading spinner while generating, then the explanation, up to 3 block-quoted source passages with their document title, a "full passage" toggle, **Add to canvas**, **Regenerate explanation** (the `~` regeneration control, hidden once the card is on the canvas), close, and Retry on error. Nothing is saved until the author presses Add to canvas.
- **Canvas nodes:** 220 px cards. Gold nodes have a gold border and cream fill; silver nodes have a grey-blue border and fill. Each shows a "highlight"/"query" badge, the concept, a 140-character explanation and the source title, plus a remove (×) button. New nodes go on a 2-column staggered grid. Nodes are draggable. The view re-fits (max zoom 1) when cards are added or removed. Edges are labelled with arrowheads.
- **Query Panel:** chat bubbles for the question and the answer, with the cards under each answer and a bordered left edge in the card's link color. A silver-node click scrolls to and flashes that turn.
- **Regeneration of query answers:** not offered (ask again instead). Query history persists.

## Verification done
- `npm run typecheck`, `npm test` (8 unit tests of the tool steps) and `npm run build` all pass.
- An end-to-end run against the real Claude CLI in headless Chromium (`tests/e2e/walkthrough.cjs`) reached every transformation of processes 1–9. Highlights appeared about 13 s after typing stopped (5 s pause plus about 6–8 s of model time).

## Did the design remind me of a specific published system?
I did not recognise this design as one specific published system, and I did not look one up. The combination — fiction writers, proactive inline highlighting of domain-knowledge gaps, a "Semantic Frame", a Knowledge Canvas with gold and silver nodes — does not match any paper I can name with confidence. Several parts do resemble systems I know, and some of my choices came from that general knowledge rather than from the design:

- **GraphRAG (Microsoft, Edge et al. 2024) and similar graph-RAG pipelines:** the ingestion setup came from this pattern, not from the design. That means running LLM extraction of entities and relations per text chunk, keeping each tied to its source chunk, merging entities by normalised name, and doing seed-then-expand multi-hop retrieval over relations.
- **ScholarPhi / Semantic Reader (Head et al. 2021):** inline marked terms you click to get a definition card with its source. This informed the subtle underline and the popover anchored at the phrase.
- **Graphologue / Sensecape (Jiang et al. 2023):** color-coded links between an LLM answer's text and structured nodes. This informed the hover cross-highlighting between answer phrases and cards.
- **Wordcraft / Dramatron and other AI writing assistants:** I knew these generate story text. That was only a contrast here: I made sure no endpoint writes prose into the draft.

The specific mechanics (the 5 s pause, gold vs. silver nodes, provenance navigation, the semantic frame from draft plus canvas) come from the design text. The concrete algorithms for them (thresholds, the edge-labelling cascade, context-based re-location of origin spans) are my own.
