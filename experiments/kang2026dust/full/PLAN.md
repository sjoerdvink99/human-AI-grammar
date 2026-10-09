# Plan — System X (weekly highlight remix)

Design: `design.json` (4 processes, no references, no images).

## Stack (recommended default, taken without waiting)

- **Backend:** Node 20, built-in `http` module only (no dependencies), JSON-file persistence in `data/store.json`.
- **Frontend:** single static page, vanilla JS + CSS, served by the backend.
- **Model:** one function `callModel(prompt)` in `lib/model.js` that runs the local Claude Code CLI
  (`claude -p --output-format json`, `CLAUDECODE` removed from the env). Swappable via `setModelProvider`.
- **Tests:** `node --test` with a stub model provider; `node --check` as a syntax check.

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| highlights | `Highlight[]` `{id,text,book,author,location,addedAt}` | uploaded e-book highlights | `lib/highlights.js`, `lib/store.js` |
| highlight (\_1, \_2) | `Highlight` referenced by `week.highlightId` | this week's (or next week's) highlight | `lib/store.js` |
| keywords | `string[3]` on `week.keywords` | three hint words, validated: exactly 3, ≤3 words each, none quotes ≥4 consecutive words of the highlight | `lib/steps.js` |
| response | `string` on `week.response` | reader's short reflection | `public/app.js`, `lib/steps.js` |
| remix | `string` on `week.remix` | new text blending reflection + highlight | `lib/steps.js` |
| retry | categorical button "Try again" (allowed once, `week.retryUsed`) | request for another version | `public/app.js` |
| alternative_remix | `string` on `week.alternativeRemix` | second remix, shown beside the first | `lib/steps.js` |
| interest | `string` (one word) on next week's `week.interest` | reader's current interest | `public/app.js`, `lib/steps.js` |
| archive_filter | `"all" \| "remixed"` | archive filter | `public/app.js` |
| filtered_highlights | `Highlight[]` | highlights matching filter | `lib/steps.js#filterArchive` |
| archive_choice | `{highlightId}` | the opened highlight | `public/app.js` |
| archive_view | rendered card | highlight + metadata + all keywords/responses/remixes | `public/app.js#renderArchiveView` |

## Transformations

| Process | Actor op | Function | File |
| --- | --- | --- | --- |
| 1 | tool select | `selectHighlight` (random, prefers never-shown) triggered by `ensureCurrentWeek` on first visit in a new Monday-week | `lib/steps.js` |
| 1 | model generate~ | `generateKeywords(highlight)` | `lib/steps.js` |
| 1 | human generate | reflection textarea + "Write reflection" submit | `public/app.js` |
| 1 | model compose~ | `composeRemix(highlight, keywords, response)` → reveals quote+source | `lib/steps.js` |
| 2 | human specify | "Try again" button (once) | `public/app.js` |
| 2 | model compose~ | `composeRemix(..., {alternative:true, previous})` → `alternativeRemix` | `lib/steps.js` |
| 3 | human specify | optional "next week's interest" word field, shown after a remix exists | `public/app.js` |
| 3 | tool select | `selectHighlight` for next Monday | `lib/steps.js#prepareNextWeek` |
| 3 | model generate~ | `generateKeywords(highlight, interest)` — interest word enforced in output | `lib/steps.js` |
| 4 | human select | filter toggle All / With remixes | `public/app.js` |
| 4 | tool select | `filterArchive` | `lib/steps.js` |
| 4 | human select | click a highlight in the list | `public/app.js` |
| 4 | tool translate | `renderArchiveView` | `public/app.js` |

## Open choices (defaults chosen)

- Upload formats: Kindle `My Clippings.txt`, CSV (`text,book,author`), JSON array, or plain text (one highlight per paragraph).
- "Each Monday": weeks keyed by ISO Monday date; selection happens lazily on the first visit in a week. A demo control simulates advancing the clock to next Monday.
- Layout: three tabs — This week · Archive · Library (upload).
- Persistence: single local JSON file, single reader.
