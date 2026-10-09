# NOTES — decisions the design did not determine

The design gives only four expressions: no name beyond "System X", no goal, no descriptions,
no representation descriptions, no references, no images. Everything below was chosen by me.

## Domain interpretation
- **What a "highlight" is**: a passage a person saved while reading (Kindle/e-reader style).
  Record fields: `id, text, source, author, location, addedAt, lastSurfacedAt, surfacedCount`.
- **keywords**: 3–6 short themes (1–4 words) the model draws from the passage, offered as prompts
  for the user's response. Clicking a keyword appends it to the response textarea.
- **response**: the user's free-text reflection. Minimum 3 characters; no maximum.
- **remix**: a 60–120-word first-person note that weaves the passage with the user's response,
  "in the reader's voice". (Could equally have been a poem, a summary, or a new quote — I chose a
  note-to-self.)
- **retry** (categorical): `shorter`, `more-poetic`, `more-concrete`, `different-angle`,
  `closer-to-my-words`.
- **alternative_remix**: every alternative is kept on the entry and shown side-by-side with the
  original remix. There is no "replace the remix with this alternative" action, because the design
  has no step for it.
- **interest**: free text; used both to pick the highlight and to steer keywords_2.
- **archive_filter**: one value from `All sources` + each distinct source title.
- **archive_choice**: record `{highlightId, entryId, version}`; a dropdown picks which remix/alternative
  of the chosen highlight goes on the card (defaults to the latest remix).
- **archive_view**: a PNG "share card" drawn on a `<canvas>` (quote, attribution, response, remix,
  date), with a Download button. Highlights that were never remixed render quote-only.

## Process wiring / triggers (no descriptions in the design)
- Process 1 starts automatically on page load: the tool resurfaces a highlight and keyword generation
  starts immediately. "Resurface another" re-runs the tool select.
- Tool select (P1): least-recently-surfaced highlight, random among ties, never the one just shown.
- Process 2 is available as soon as a remix exists (retry chips under the remix).
- Process 3 ("Where next?") only appears after a remix exists, because it continues from remix_1.
  The selected highlight_2 replaces the current highlight and the Today view resets so the user can
  respond again (i.e. it feeds back into process 1's human step).
- Tool select (P3): bag-of-words matching with a naive stemmer and IDF weighting over text, source,
  author; excludes the highlight of the current remix (this is how remix_1 is used). If nothing
  matches, it falls back to resurfacing and tells the user.
- Process 4 is a separate "Archive" tab, always reachable (not gated on a remix).
- The starting collection highlights_1 comes from a seed file of 14 public-domain quotes
  (Thoreau, Marcus Aurelius, Seneca, Emerson, Montaigne, Shelley). There is no import UI because
  the design has no step for it; edit `data/seed.json` and delete `data/store.json` to load your own.

## Data formats & persistence
- One JSON file `data/store.json` with `{highlights: [], entries: []}`.
- Entry = `{id, highlightId, keywords, response, remix, alternatives: [{style, text, createdAt}], createdAt}`.
  Response and remix are saved together when the remix is composed (a response without remix is not saved).

## Model calls
- One provider function, `callModel(prompt, validate)` in `server/model.js`: spawns
  `claude -p --output-format json`, prompt on stdin, `CLAUDECODE` removed from env, 120 s timeout,
  reads `.result`, extracts the first JSON object, validates, retries once on invalid output.
- Prompts (in `server/operations.js`) ask for JSON only: `{"keywords": [...]}` or `{"text": "..."}`.
- Validation: keywords deduped, ≤4 words / ≤40 chars each, 3–6 kept, else retry; remix text non-empty
  and ≤180 words.
- No streaming (the CLI JSON mode returns the whole result); loading indicators instead.

## Stack, layout, styling
- Node 20, zero dependencies: `node:http` server and vanilla ES-module frontend; `node --test` for tests.
- Layout: header with two tabs; Today = main column (highlight card, keywords chips, response,
  remix grid + retry chips) and a side column ("Where next?", collection stats); Archive = filter chips
  and list on the left, rendered card on the right.
- Styling: warm paper palette (cream background, rust accent), Georgia serif for quotes and remixes,
  system sans for UI; pill-shaped chips; errors as a toast.

## Verification
- `npm test` (5 tests for tool steps and JSON extraction) and `npm run check` pass.
- Walked through every API step against the real CLI: surface → keywords → remix → alternative
  (shorter) → select-by-interest ("coping with sudden change" → Shelley, "great and sudden change") →
  keywords with interest → archive filters → filtered archive. All returned valid output.
- Frontend was syntax-checked but not driven in a browser in this session; the canvas card
  (`renderCard`) was therefore not visually verified.

## Did the design remind me of a published system?
Not of one specific paper I can name with confidence. The identifiers (highlights, resurfacing,
response, remix, archive) reminded me most of **consumer highlight-resurfacing products such as
Readwise's Daily Review** (spaced resurfacing of Kindle highlights), combined with HCI work on
LLM-supported reflective reading/writing. Choices that came from that background knowledge rather
than the design:
- treating highlights as book passages with source/author/location fields and seeding with book quotes;
- the "least recently surfaced" resurfacing rule for the first tool select;
- framing the response as a personal reflection and the remix as a first-person note-to-self;
- the archive card as a shareable quote image (a common feature of such products).
