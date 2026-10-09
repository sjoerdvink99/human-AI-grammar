# NOTES — decisions the design did not determine

The design gives only the four expressions. It has no goal, description, representation texts,
process descriptions, references or images, and the identifiers are anonymous (`r1`…`r16`).
Almost everything about *meaning* below is therefore my decision.

## Meaning of the representations

| id | what the design says | what I chose |
|---|---|---|
| r1 | artifact tabular, extracted from, then replaced in P2/P3/P4 | the working data table |
| r2 | artifact record*, extracted from r1, reassigned after table changes | field metadata: name, type (quantitative/nominal/temporal), source (original/reshaped/derived), derivation |
| r3 | instruction record, translated into r4 | the encoding: mark plus channel → field (x, y, color, size, column) and an aggregate per channel |
| r4 | artifact record, executed into a visual | a Vega-Lite spec |
| r5 / r10 | artifact visual (r10 a collection) | rendered charts / a gallery of candidate charts |
| r6 | artifact record*, specified by a human before r3_2 | "new concepts": names of fields that aren't in the table yet |
| r7 | instruction tabular, composed by a tool, then modified by a human | an example table (shelf fields as columns), prefilled from the data where it can be; the user fills in the new-concept cells |
| r8 | artifact formal*, from a *different tool* (tool_2) | reshaping programs (`fold`, `pivot`) found by enumerative programming-by-example |
| r9 | artifact tabular* | the candidate tables those programs produce |
| r11 | instruction record, later modified (P4) | derived-field request: name, natural-language description, source fields |
| r12 | instruction formal* composed by a tool and fed to a model | prompts written as code skeletons (a JS function stub with a doc comment, typed parameters and sample rows), 3 variants |
| r13 | artifact formal* from the model | JS `derive(row, index, table)` functions |
| r14 + r15 | artifact formal* + artifact tabular* from a tool evaluate | the candidates that ran without error, merged when their outputs are identical, and a preview table for each (source fields plus the new column) |
| r16 | artifact formal, the selected one | the chosen function, kept on the field so it can be edited later (P4) |

Because I read P2's `[human select]` as producing r1_2 and r5_2, picking a candidate makes its table the working table and its chart the main chart.

## Interaction / process choices

- **P2 trigger**: drop a concept on a shelf → the chart area shows "Formulate data by example…" → a side panel opens.
- **P4 trigger**: a ✎ button on a derived field chip reopens the derive form, filled in with the saved request. Only the description and source fields can be changed; the name stays fixed. Executing replaces the column where it is.
- While redefining a field, the old column is removed from the prompt's sample rows and from the evaluation table, so the model can't just copy the old values.
- **Generative step handling (`~`)**: a spinner for each phase (generating, evaluating). The prompts sent are shown on request. A Regenerate button is available. Candidates that throw, time out (2 s), return only nulls, or duplicate another candidate's output are rejected and listed with the reason. Nothing changes in the table until the user picks a candidate and clicks Apply. If only one candidate survives, it is preselected.
- The P2 example-table step: blank cells count as "unknown". If the examples rule out every program, an error explains why. Up to 6 candidates are shown.
- Synthesizer search space: `fold` (wide→long) when exactly two new concepts are used (key and value). It tries 4 choices of which columns to fold: columns named in the examples, columns of the same type, all quantitative columns, and all free columns. `pivot` (long→wide) runs when the new concept names match values of a categorical column. It tries two index choices.
- Data versions: every table change is added to a version list in the sidebar, with "revert". The design doesn't compare versions; I kept the list so the user can undo.
- After a reshape, shelf entries whose fields no longer exist are cleared.
- Persistence: none (in-memory, per browser tab).

## Layout and styling

- Header (sample picker, CSV/JSON upload) / left sidebar (field chips, concepts, derive button, data versions) / centre (mark buttons, channel shelves, chart, collapsible Vega-Lite spec, data table) / right side panel (formulate or derive).
- Chips are colour-coded by provenance: blue original, green reshaped, amber derived, dashed pink for concepts not in the data yet. Table headers use the same colours.
- Fields go onto shelves by HTML5 drag-and-drop, or through a dropdown on each shelf.
- Code uses a small regex-based highlighter on a dark background.

## Data formats

- Tables: `{name, columns[], rows: Record<string, string|number|boolean|null>[]}`. CSV is parsed with PapaParse (dynamic typing); JSON must be an array of objects.
- Type inference: quantitative if every value is numeric; temporal if every value matches `YYYY-MM(-DD)( time)`; otherwise nominal.
- Three bundled sample tables with invented numbers: wide fruit sales (for fold), long city temperatures (for pivot), student scores (for derive).

## Model prompts

- System prompt: "You are a careful JavaScript programmer who completes data-transformation functions. Output only code."
- User prompt: see `src/tools/composePrompts.ts`. The 3 variants differ in which sample rows they show (first, last, evenly spread) and in a one-line hint (direct / handle missing values / consider alternative interpretations).
- Response parsing: the first fenced code block that contains `function derive(`.
- One CLI call per prompt, in parallel; 180 s timeout per call.

## Libraries

React 19 + Vite + TypeScript; Express 5 run with tsx; vega / vega-lite / vega-embed; PapaParse; Vitest; node:vm for sandboxed execution. Note: node:vm is an isolation convenience, not a security boundary. That's acceptable for a local, single-user tool, but not for a public deployment.

## Verification status

- `npm run typecheck`, `npm test` (6 tests covering P1–P3 tool steps) and `npm run build` all pass.
- The model path was exercised end to end against the real CLI through the HTTP API: 3 candidates generated, 2 merged as duplicates, 1 applied.
- I did **not** click through the UI in a browser. The components type-check and the production bundle is served, but drag-and-drop and the panels have not been tested by hand.

## Did the design remind me of a published system?

Yes. Strongly of **Data Formulator** (Wang, Thompson, Lee, Drucker, Microsoft Research; IEEE VIS 2023), and its P3/P4 part of the LLM-based "derive concept" feature in Data Formulator.
The sequence gave it away: extract fields → encoding shelves → chart, then "new concepts" + an example table + a non-model program synthesizer + candidate charts. Also: model-generated code candidates that are run and filtered before the user picks one.

Choices that came from that knowledge rather than from the design:
- Reading r6 as user-named **"concepts"** placed on encoding shelves before they exist in the data, and r7 as an **example table** built from the shelf fields.
- Reading tool_2 as a **programming-by-example reshaping synthesizer** limited to fold/pivot-style transformations, and r10 as a gallery of candidate charts the user picks from.
- Reading r12 as prompts **written as code templates** (function stub + doc comment) and r13 as **code** rather than values, and r14/r15 as candidates filtered by execution, with output previews for comparison.
- Reading P4 as **editing an existing derived concept's description** and regenerating it.
- The overall shelf-based encoding UI (Tableau/Polestar-style), and colour-coding of original vs. derived fields.

Not taken from it: the actual prompts, the synthesizer's algorithm and search space, the sample data, the layout details, the version list, the use of Vega-Lite specifics beyond "a chart spec", and the provider setup.
