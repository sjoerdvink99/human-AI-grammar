# NOTES — decisions the design did not determine

The design fixed the steps, actors, representations and triggers (Monday selection, three keywords,
hidden quote, reveal on remix, one "Try Again", optional one-word interest, archive filter to remixed
highlights). Everything below was my choice.

## Stack and architecture
- **Libraries:** none. Node 20 built-in `http`, vanilla JS/CSS frontend, `node --test` for tests. Chosen to keep the
  experiment minimal and dependency-free.
- **Model provider:** `lib/model.js#callModel(prompt) → text` is the single swap point; default runs
  `claude -p --output-format json` (prompt on stdin, `CLAUDECODE` unset, 180 s timeout, optional `CLAUDE_MODEL`).
  `callModelJson` extracts the first `{…}` from the reply. `setModelProvider` swaps it (tests use a stub).
- **Persistence:** one JSON file (`data/store.json`) with `highlights[]`, `weeks[]` and a demo `dayOffset`. Single reader, no accounts.
- **Data format:** a `Week` record per Monday (`week`, `highlightId`, `keywords[3]`, `interest`, `response`, `remix`,
  `alternativeRemix`, `retryUsed`). Highlights are `{id, text, book, author, location, addedAt}`.

## Upload (start of process 1)
- Accepted formats: Kindle `My Clippings.txt` (notes/bookmarks skipped), CSV with `text/highlight`, `book/title`,
  `author` columns, JSON array, and plain text with one highlight per paragraph plus an optional `— Author, Book` line.
- File picker or paste; exact-duplicate texts are skipped. A "Load sample highlights" button loads 10 well-known quotations.

## Weekly trigger and selection
- "Each Monday" = weeks keyed by the local-time ISO Monday date; selection happens lazily on the first visit in a new
  week (no background scheduler or email/push notification).
- Random selection prefers highlights never resurfaced; when all have been shown, it draws from all again.
- A footer **demo clock** ("Skip to next Monday" / "Back to today") simulates time passing. This is not a design step,
  only a way to reach the Monday trigger in a demo.

## Keywords (`[model generate]~`)
- Prompt: three lowercase keywords (one or two words) hinting at ideas/mood/imagery, no distinctive phrases, no
  book/author; JSON `{"keywords": [...]}`.
- Enforced in code (not just the prompt): exactly 3, distinct, ≤ 3 words / 30 chars each, and none copying ≥ 4
  consecutive words of the passage. Up to 3 attempts; on failure the UI shows an error with "Try again".
- Process 3: the interest word is forced into the list (inserted if the model omitted it) and placed in the middle;
  it is highlighted in the accent colour.

## Reflection and remix (`[human generate]`, `[model compose]~`)
- Reflection: free textarea, 3–3000 characters, prompt "What do these three words bring up for you right now?".
- Remix prompt: one 60–140 word prose(-poem) piece blending reflection and passage, keeping the reader's voice,
  echoing at least one phrase of the passage, no title/preamble. Input: highlight + keywords + response.
- Validation: strips code fences / "Here is…" preambles / wrapping quotes, min 20 chars, max 2000.
- Reveal: the hidden-passage placeholder (dashed, striped box) is replaced by the quote with author, book and location,
  using a blur-in animation. The server never sends the quote before the remix exists.

## Alternative remix (process 2)
- "Try again" is shown once; the server enforces one retry per week. The alternative prompt includes the first
  remix and asks for a different angle/form; identical output is rejected. Both are shown side by side
  ("Remix" / "Alternative remix"); neither is marked as preferred (the design has no choose step).

## Next week's interest (process 3)
- Shown after the remix as an optional single-word field ("e.g. patience"), lowercased, letters/digits/hyphen only.
- Next week's highlight and keywords are generated immediately and stored for next Monday, hidden until then.
  Re-submitting replaces them, unless next week has already been answered. The interest highlight excludes all used ones.

## Archive (process 4)
- Two-column layout: list on the left with filter chips "All highlights" / "With remixes", detail on the right.
- List items: first 110 characters + book + "remixed" badge, sorted by most recent resurfacing.
- Detail (`archive_view`): quote, author, book, location, date added, times resurfaced, and per week the keywords,
  reflection, remix and alternative remix.
- Future (prepared) weeks are excluded; the current week's highlight is masked until its remix exists so the
  archive can't spoil the hidden quote.

## Layout and styling
- Three tabs: This week · Archive · Library. Warm paper palette, serif body (Iowan/Palatino/Georgia), terracotta
  accent, keywords as large italic pills. Responsive: comparison and archive collapse to one column under 720 px.

## Verification
- `npm test`: 5 tests pass (parsers, week math, keyword validation, selection, full processes 1–4 with a stub model).
- Ran the server against the real Claude CLI and exercised every endpoint: upload → keywords
  (`unseen, heart, true sight`) → reflection → remix with revealed quote → alternative remix → interest "courage" →
  next Monday's keywords `burden, courage, choice` → archive filter. Every transformation was reachable.
- Not done: no automated browser test of the frontend; the UI was checked only by reading the code and serving the page.

## Did the design remind me of a published system?
It reminded me of **Readwise** (a commercial service that resurfaces Kindle highlights in a daily review), and generally
of spaced-repetition / "resurfacing" tools for reading notes. I don't know of a specific research paper with
this exact keyword → reflection → remix loop, so I didn't model the build on any paper.
Choices that came from that background knowledge rather than from the design: supporting the Kindle `My Clippings.txt`
format (and its "Title (Author)" / "Your Highlight on Location …" layout), the preference for highlights not yet
resurfaced, and showing the book/author/location as source metadata. Everything else came from the design text or
my own defaults.
