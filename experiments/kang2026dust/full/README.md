# System X — weekly highlight remix

Upload your e-book highlights. Every Monday one comes back as three keywords, with the passage hidden.
You write a short reflection; a language model blends it with the original passage into a *remix*, and the
passage and its source are revealed. You can ask for one alternative remix, set a word for next week's
keywords, and browse everything in the archive.

## Run

```bash
npm start          # http://localhost:3000  (PORT, STORE_FILE, CLAUDE_MODEL, CLAUDE_BIN env vars optional)
npm test           # unit + full-flow tests with a stub model
npm run check      # syntax check
```

Requirements: Node ≥ 20 and the Claude Code CLI (`claude`) on the PATH. No npm dependencies.
Model calls go through `callModel` in `lib/model.js`, which runs `claude -p --output-format json`
with `CLAUDECODE` removed from the environment; call `setModelProvider(fn)` to swap providers.

Data lives in `data/store.json`. The footer's "Skip to next Monday" simulates the weekly clock for demos.

## Design → code

The design is in `design.json` (see `PLAN.md` for the representation table).

| Process | Step | Code |
| --- | --- | --- |
| 1 Weekly reflection & remix | upload `highlights` | `lib/highlights.js#parseHighlights`, `Service.upload` |
| | `[tool select]` → `highlight_1` (first visit of each Monday-week) | `lib/steps.js#selectHighlight`, `Service.ensureCurrentWeek` |
| | `[model generate]~` → `keywords_1` | `lib/steps.js#generateKeywords` (+ `validateKeywords`) |
| | `[human generate]` → `response_1` | reflection form in `public/app.js#renderWeek` |
| | `[model compose]~` → `remix_1` (reveals quote) | `lib/steps.js#composeRemix`, `Service.respond` |
| 2 Alternative remix | `[human specify]` → `retry_1` | "Try again" button, `Service.retry` (once per week) |
| | `[model compose]~` → `alternative_remix_1` | `composeRemix(..., previous)`; side-by-side view |
| 3 Next week's interest | `[human specify]` → `interest_1` | interest form, `normalizeInterest` |
| | `[tool select]` → `highlight_2` | `Service.setInterest` → `selectHighlight` |
| | `[model generate]~` → `keywords_2` | `generateKeywords(highlight, interest)`; interest enforced by `validateKeywords` |
| 4 Archive | `[human select]` → `archive_filter_1` | All / With remixes chips |
| | `[tool select]` → `filtered_highlights_1` | `lib/steps.js#filterArchive`, `GET /api/archive` |
| | `[human select]` → `archive_choice_1` | click list item |
| | `[tool translate]` → `archive_view_1` | `public/app.js#renderArchiveView` |
