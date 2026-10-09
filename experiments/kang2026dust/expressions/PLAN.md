# PLAN — System X

The design (`design.json`) has no goal, descriptions, representation descriptions, references or images.
Everything below about *meaning* is inferred from identifiers and structure, and the recommended
default is taken for each open choice (no confirmation was waited for, per the experiment rules).

## Interpretation

A personal **reading-highlights resurfacing and remix** app. The user owns a collection of
highlights (passages saved from books/articles). Each session the app resurfaces one highlight,
a model offers a few keywords to think with, the user writes a response, and a model composes a
"remix" — a short new piece that weaves the passage and the user's response together. The user
can ask for an alternative remix with a categorical retry style, can find a highlight by stating
an interest, and can browse an archive filtered by source and render any item as an image card.

## Stack (empty repo → minimal stack)

- Node 20, zero runtime dependencies: `node:http` server, static vanilla-JS ES-module frontend.
- Persistence: a single JSON file `data/store.json` (seeded from `data/seed.json` on first run).
- Model provider: one function `callModel(prompt, schema)` in `server/model.js`, which spawns
  `claude -p --output-format json` with `CLAUDECODE` removed from the environment.
- Tests: `node --test`.

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| highlights | `Highlight[]` (record collection) | `{id, text, source, author, location, addedAt, lastSurfacedAt, surfacedCount}` | `server/store.js`, `data/seed.json` |
| highlight (v1, v2) | `Highlight` | the currently surfaced highlight; v2 = chosen by interest | `public/app.js` `state.highlight` |
| keywords (v1, v2) | `string[]` (3–6 items) | short themes/keywords the model draws from the highlight (v2 also tuned to the interest) | `server/operations.js` |
| response | `string` | the user's own written reaction to the highlight | `public/app.js`, saved in an `Entry` |
| remix | `string` | model-composed short piece combining highlight + response (+keywords) | `server/operations.js`, `Entry.remix` |
| retry | categorical: `shorter \| more-poetic \| more-concrete \| different-angle \| closer-to-my-words` | the style of a requested alternative | `public/app.js` retry buttons |
| alternative_remix | `string` | an alternative remix; all alternatives kept on the entry | `Entry.alternatives[]` |
| interest | `string` | free text naming what the user is curious about now | `public/app.js` interest field |
| archive_filter | categorical: `All sources` or one source title | filter over the archive | `public/app.js` |
| filtered_highlights | `Highlight[]` | highlights from that source (with their entries) | `server/tools.js` `filterHighlights` |
| archive_choice | record `{highlightId}` | the item the user picked in the archive | `public/app.js` |
| archive_view | visual (PNG via canvas) | an image card of the highlight + response + remix | `public/card.js` |

An `Entry` = `{id, highlightId, keywords, response, remix, alternatives[{style, text}], createdAt}`
is how response/remix are persisted so the archive (process 4) can show them.

## Transformations

| # | Actor op | Function / component | File |
| --- | --- | --- | --- |
| P1.1 | tool select | `selectHighlight(highlights)` — least recently surfaced, random tie-break | `server/tools.js` |
| P1.2 | model generate~ | `generateKeywords(highlight)` | `server/operations.js` |
| P1.3 | human generate | response textarea + "Remix" button | `public/app.js` |
| P1.4 | model compose~ | `composeRemix(highlight, keywords, response)` | `server/operations.js` |
| P2.1 | human specify | retry-style buttons under the remix | `public/app.js` |
| P2.2 | model compose~ | `composeAlternative(highlight, response, remix, retry)` | `server/operations.js` |
| P3.1 | human specify | "Find by interest" input | `public/app.js` |
| P3.2 | tool select | `selectByInterest(highlights, interest, excludeId)` — token-overlap scoring | `server/tools.js` |
| P3.3 | model generate~ | `generateKeywords(highlight, interest)` | `server/operations.js` |
| P4.1 | human select | source filter chips in Archive | `public/app.js` |
| P4.2 | tool select | `filterHighlights(highlights, filter)` | `server/tools.js` |
| P4.3 | human select | click an archive row | `public/app.js` |
| P4.4 | tool translate | `renderCard(item)` → canvas → PNG | `public/card.js` |

## Images

None in the design.

## Open choices (defaults taken)

- Model provider: local Claude Code CLI behind `callModel` (required by the experiment).
- Persistence: JSON file on disk.
- Layout: two tabs — **Today** (processes 1–3) and **Archive** (process 4).
- Generative handling: loading indicators, JSON validation of outputs with one automatic retry,
  "Regenerate keywords" button, human review (the user sees the remix before anything else happens).
