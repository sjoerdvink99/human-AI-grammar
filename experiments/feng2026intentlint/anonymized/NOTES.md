# NOTES — decisions the design did not determine

The design names no goal and no description, describes none of its representations, and has no references or
images. It fixes only the process structure: identifiers, roles, media, actors, operations, versions,
collections and generativity. Everything below is my choice.

## Domain and meaning of the identifiers

| id | design type | what I made it |
| --- | --- | --- |
| r1 | artifact record | an uploaded dataset `{name, format, content}` (CSV or JSON array of objects) |
| r2 | instruction record* | a persistent library of reusable **analysis guidelines** `{id, title, when, instruction, source, updatedAt}` |
| r3 | instruction language | the user's analysis question (r3_1), and a self-contained refined version (r3_2) |
| r4 | artifact record | a data profile extracted from r1: row count; per column the type, missing count, unique count, examples, min/max/mean |
| r5 | selection record* | references into r2: `{guideline_id, reason}` |
| r6 | evaluation record* | one per matched guideline: `{guideline_id, verdict ∈ applied/partially_applied/not_applicable, note}` |
| r7 | artifact formal | a Python 3 / pandas (+ matplotlib) script |
| r8 | instruction record* | suggested new guidelines `{title, when, instruction, rationale}`, edited in place (r8_2) |
| r9 | instruction record* | the suggestions the user ticked |
| r10 | selection record* | ids of library guidelines the user selected. I use it for **export as JSON**; the design gives it no consumer |

The "analysis guidelines" domain is my overall reading of the design: a record artifact, a reusable rule
collection, NL request rewriting, and formal output.

## Process triggers and flow
- Process 1: clicking **Run** stores r3_1, then runs extract → match → refine automatically. It pauses at the
  human select step. A step tracker (pills) shows running, done, waiting and failed states.
- Human select (r3_1 + r3_2 + r6 → r3_2): the original and refined requests are shown side by side with
  verdict chips. "Regenerate refinement" creates a new version, and earlier versions stay available as tabs. The
  user picks one with "Use this refined request". There is no "use the original" option, because the design's
  next state contains only r3_2.
- model_4 sees **only r3_2**, because that is all its preceding state contains. So I instructed model_2 to make
  r3_2 self-contained (file name, format, exact columns and types). Code has Copy, Download (.py) and
  Regenerate. The code is **not executed**, because the design has no execute step.
- Process 2 has no trigger in the design. Its panel appears once r5 exists, and it starts when the user clicks
  "Suggest guidelines from this request". All suggestions start ticked. Compose keeps the unticked ones in the panel.
- Processes 3 and 4 have no trigger either. They are always available in the library panel.
- r5 is also shown in the library itself: matched guidelines get a blue left border and their match reason.

## Validation of model outputs (enforced in code, `src/steps.js`)
- r5: ids must exist in r2, and duplicates are removed.
- r6: verdicts must come from the enum. There is one evaluation per matched guideline, and a placeholder is filled
  in if the model leaves one out. Evaluations for unmatched ids are dropped.
- r3_2: must not be empty.
- r7: Markdown fences are stripped, and the code must contain an `import`.
- r8: title and instruction must not be empty, titles are capped at 120 characters, titles already in r2 are
  dropped, and at most 6 suggestions are kept.
- compose (tool_2): titles are deduplicated after case and whitespace normalisation, and ids `g_xxxxxxxx` are assigned.
- library edits: title and instruction are required.

## Model prompts
There is one system prompt and one JSON schema per operation (`src/steps.js`). Each is passed to
`callModel()` (`src/model.js`), which runs `claude -p --output-format json --tools "" --system-prompt …
--json-schema …` with stdin as the prompt and `CLAUDECODE` deleted from env. It reads
`structured_output`, and falls back to loose JSON parsing of `result`.
- model_1: "match request against library; select only guidelines whose condition holds; one-sentence reasons".
- model_2: "rewrite to follow selected guidelines; self-contained for a code generator that sees nothing else;
  numbered plan; keep intent; then evaluate each guideline".
- model_3: "propose 2–4 reusable guidelines revealed by this request and dataset; no duplicates or contradictions".
- model_4: "single runnable pandas script; load the named file; use only the stated columns; comment each step".
All four model roles use the same underlying model (CLI default). They differ only in prompt and schema.

## Stack, persistence, data formats
- Node 20, Express 4, a vanilla-JS ES-module frontend with no build step, and `@highlightjs/cdn-assets`
  (served locally) for Python highlighting. Tests use `node:test` and cover the tool steps.
- The library is persisted in `data/library.json`. It is created from `data/seed-library.json`, which holds 6
  example guidelines. All other state lives in the browser session and is not persisted.
- The client sends r1 (up to 5 MB) and r4 to the server on each call. The server holds no session state.
- I included a sample dataset, `data/samples/orders.csv` (240 synthetic orders with some missing values).
- Column type inference: boolean, integer, float, ISO datetime, categorical (≤ max(20, 20% of rows) unique
  values), or text.

## Layout and styling
- Two columns. Left: the dataset panel (upload, sample, collapsible profile table with a missing-value bar)
  and the guideline library (checkboxes, Edit/Delete, + Add, a selection bar with Export). Right: the request
  and step tracker, then the matched guidelines, the refinement comparison and evaluations, the generated code,
  and the suggestions panel.
- A light, neutral theme with one blue accent and green/amber/grey verdict chips. Small monospace tags
  (`r3_2`, `r6`, …) on each panel trace it back to the design.

## Verification
- `npm test` passes (6 tests), and `npm run check` passes.
- I called every server endpoint once against the live CLI with the sample data:
  extract (instant), match (~6 s, 5 matches), refine (~20 s), generate-code (~80 s), suggest (~14 s, 4
  suggestions), compose, and library add/edit/delete. All returned valid outputs.
- I did **not** click through the UI in a real browser, because no browser automation was available in this
  session. Each client handler calls the endpoints listed above.

## Did the design remind me of a published system?
Not of one specific system I can name with confidence. The design is abstract (r1…r10, no goal), and nothing in
it points to a particular paper. Its shape — a reusable library of instruction records that a model matches to a
request, a request rewritten under those rules with per-rule evaluations, code generated from the rewrite, and
new rules mined back into the library — resembles a general family I know: LLM data-analysis and
NL-to-code assistants with persistent user/team "memory" or "rules", and prompt-refinement tools that show how
constraints were applied. My choices of **data analysis** as the domain, **pandas code** as r7, and
**guidelines with an "applies when" condition** come from that general familiarity, not from the design. They
are not taken from any specific published system. Everything else follows from the grammar and from the
defaults listed above.
