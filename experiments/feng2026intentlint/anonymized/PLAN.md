# PLAN — System X

The design (`design.json`) has no goal, description, representation descriptions, references or images —
only four abstract processes over identifiers `r1`…`r10`. The plan therefore first fixes a concrete
interpretation, then maps each step to code. Defaults below were taken without waiting for confirmation
(per the experiment instructions).

## Interpretation (inferred; design does not say)

A **guideline-aware analysis-code assistant**. The user loads a dataset and asks a question in natural
language. The system consults a persistent library of reusable *analysis guidelines* (team / personal
conventions such as "always report missing values before aggregating"), picks the relevant ones, rewrites the
question into a refined prompt that follows them, lets the user accept the refinement, and then generates
Python (pandas) code. From the same context, it can propose new guidelines the user edits, picks, and
merges into the library. The library can be edited and selected (for export) directly.

## Representations

| id | role / medium | contents (inferred) | file |
| --- | --- | --- | --- |
| r1 | artifact record | dataset: `{name, format: "csv"\|"json", content}` | `public/app.js` (state.r1), `src/tools.js` |
| r2 | instruction record * | guideline library: `{id, title, when, instruction, source, updatedAt}` | `src/library.js`, `data/library.json` |
| r3 | instruction language | analysis request; r3_1 user's original, r3_2 model-refined | `public/app.js` |
| r4 | artifact record | data profile extracted from r1: `{name, rowCount, columns:[{name,type,missing,unique,examples,min,max}]}` | `src/tools.js` |
| r5 | selection record * | matched guidelines: `{guideline_id, reason}` (ids must exist in r2) | `src/steps.js` |
| r6 | evaluation record * | per matched guideline, how the refinement handled it: `{guideline_id, verdict: applied\|partially_applied\|not_applicable, note}` | `src/steps.js` |
| r7 | artifact formal | Python/pandas code answering r3_2 against r4 | `src/steps.js` |
| r8 | instruction record * | suggested new guidelines `{title, when, instruction, rationale}` (r8_2 after human edits) | `src/steps.js`, `public/app.js` |
| r9 | instruction record * | the suggestions the user ticked | `public/app.js` |
| r10 | selection record * | guideline ids the user selected in the library (`{guideline_id}`), used for export | `public/app.js` |

## Transformations

| process | step | implementation | file |
| --- | --- | --- | --- |
| 1 | human specify → r3_1 | request textarea + "Run" | `public/app.js` |
| 1 | tool_1 extract r1 → r4 | `extractProfile()` (CSV/JSON parse, type inference, stats) | `src/tools.js` |
| 1 | model_1 match → r5* | `matchGuidelines()` prompt + schema, ids validated against r2 | `src/steps.js` |
| 1 | model_2 modify~ → r3_2 + r6* | `refineRequest()`; diff view original vs refined + verdict chips | `src/steps.js` |
| 1 | human select → r3_2 | "Use refined request" / "Regenerate refinement" | `public/app.js` |
| 1 | model_4 generate~ → r7 | `generateCode()`; highlighted code, copy/download, regenerate | `src/steps.js` |
| 2 | model_3 generate~ → r8* | `suggestGuidelines()` from r3_1+r4+r5+r2 (dedup against r2) | `src/steps.js` |
| 2 | human modify → r8_2* | editable suggestion cards | `public/app.js` |
| 2 | human select → r9* | checkboxes on suggestion cards | `public/app.js` |
| 2 | tool_2 compose r9 + r2_1 → r2_2 | `composeLibrary()` (assign ids, merge, dedupe by title) | `src/tools.js` |
| 3 | human modify r2_2 → r2_3 | inline edit / delete / add in library panel, saved to server | `public/app.js`, `src/library.js` |
| 4 | human select r2_2 → r10* | checkboxes in library + "Export selected" JSON | `public/app.js` |

All model steps go through one function `callModel()` in `src/model.js` (Claude Code CLI:
`claude -p --output-format json --json-schema … --tools ""`, CLAUDECODE removed from env).

## Open choices and defaults taken

- Stack: Node 20 + Express, vanilla JS frontend (no build step), highlight.js for code. Tests: `node:test`.
- Persistence: library in `data/library.json` (seeded with 6 guidelines); session state in browser memory.
- Layout: left column = dataset + profile + library; right column = request pipeline with a step tracker,
  then the suggestion panel (process 2).
- Process triggers (design gives none): process 1 runs extract→match→refine automatically on "Run", pausing
  at the human select; process 2 starts from a "Suggest guidelines" button once matching finished; processes
  3 and 4 are always available in the library panel.
- No steps added beyond the design. Export in process 4 is a plain download of the selected records, not a new step.
