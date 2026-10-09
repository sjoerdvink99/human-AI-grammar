# System X — Highlight Remix

Resurface a saved reading highlight, get a few keywords to think with, write your own response,
and let a model compose a "remix" of the passage and your response. Ask for alternative remixes,
follow an interest to the next highlight, and browse an archive that renders any item as an image card.

## Run

```bash
npm start          # http://localhost:3000  (PORT to change)
npm test           # unit tests for the deterministic tool steps
npm run check      # syntax check of all sources
```

Requires Node ≥ 20 and the Claude Code CLI (`claude`) on the PATH. Model calls go through
`callModel` in `server/model.js`, which runs `claude -p --output-format json` with `CLAUDECODE`
removed from the environment; replace that function to use another provider.
Data lives in `data/store.json` (created from `data/seed.json` on first start; delete it to reset).

## Design → code

The design is in `design.json`. Each transformation maps to:

| Process | Step | Code |
| --- | --- | --- |
| 1 | `[tool select]` highlights_1 → highlight_1 | `selectHighlight` in `server/tools.js`, `POST /api/surface`, `surface()` in `public/app.js` |
| 1 | `[model generate]~` → keywords_1 | `generateKeywords` in `server/operations.js`, `POST /api/keywords`, `loadKeywords()` |
| 1 | `[human generate]` → response_1 | response textarea in `public/index.html` |
| 1 | `[model compose]~` → remix_1 | `composeRemix`, `POST /api/remix`, `remix()` |
| 2 | `[human specify]` → retry_1 | retry-style chips (`#retry-buttons`) |
| 2 | `[model compose]~` → alternative_remix_1 | `composeAlternative`, `POST /api/alternative`, `retry()` |
| 3 | `[human specify]` → interest_1 | "Where next?" form (`#interest-form`) |
| 3 | `[tool select]` → highlight_2 | `selectByInterest` in `server/tools.js`, `POST /api/select-by-interest`, `followInterest()` |
| 3 | `[model generate]~` → keywords_2 | `generateKeywords(highlight, interest)` |
| 4 | `[human select]` → archive_filter_1 | source filter chips (`#filters`) |
| 4 | `[tool select]` → filtered_highlights_1 | `filterHighlights` in `server/tools.js`, `POST /api/archive` |
| 4 | `[human select]` → archive_choice_1 | click on an archive row (+ version dropdown) |
| 4 | `[tool translate]` → archive_view_1 | `renderCard` in `public/card.js` (canvas → PNG) |
