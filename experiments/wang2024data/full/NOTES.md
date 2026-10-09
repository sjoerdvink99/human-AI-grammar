# NOTES — decisions the design did not determine

The design fixed the steps, actors, representations and their contents. Everything below was my choice.

## Stack and libraries
- **Frontend:** Vite + React 18 + TypeScript, with plain CSS and no component library. State lives in a single `useReducer` (`src/state.ts`).
- **Charts:** Vega-Lite 5 rendered with `vega-embed`, using the SVG renderer. Only the "export" action is enabled.
- **Backend:** Express on Node, run through `tsx`. It plays the role of tool_1's "data transformation backend".
- **Code highlighting:** `highlight.js` (TypeScript and JSON). **CSV parsing:** `papaparse`. **Tests:** Vitest.
- **Model provider:** the Claude Code CLI (`claude -p --output-format json --tools "" --no-session-persistence --system-prompt …`), with `CLAUDECODE` removed from the environment and the prompt sent on stdin. Everything goes through `callModel()` in `server/model.ts`. The CLI's default model is used unless `SYSTEM_X_MODEL` is set.
- **Persistence:** none. All state stays in the browser session.

## Data formats
- **Rows:** `Record<string, string | number | boolean | null>`. Cell text is converted with `parseCell` (numeric strings become numbers, "true"/"false" become booleans, empty becomes null).
- **Concept types:** quantitative, nominal, ordinal, or temporal, inferred from the values. Temporal means ISO-like dates or `m/d/yyyy`. Ordinal is only used internally for heatmap and facet axes.
- **Concept provenance:** `original`, `custom` (pending, has `examples`), `reshaped` (a custom concept that now exists after a reshape), or `derived` (has its request history and code). Each has its own colour on cards, channels and table headers.
- **Versions:** every table version is stored together with its own concepts (`TableVersion`). Custom concepts are global until a reshape materialises them. Process 4 creates a new version instead of overwriting, so earlier versions stay selectable in the Data panel.
- **Inputs accepted:** CSV/TSV (header row) or a JSON array of objects. There are three bundled synthetic samples: a wide weekly-temperatures table, a long regional-sales table, and student scores. All values are generated deterministically in `src/samples.ts`.

## Process 1
- **Chart types:** scatter (point), bar, line, area, heatmap (rect), strip (tick).
- **Channels:** x, y, color, size, shape, column (facet).
- Concepts get onto channels by HTML5 drag-and-drop from the concept cards, or through a menu inside each channel slot.
- The chart re-renders automatically on every spec change. There is no explicit "render" button.
- No aggregation is ever added, following the design's "without transforming the data". Bar and area charts therefore show raw values (stacked where they coincide).
- A Vega-Lite spec viewer (data elided) and a "Save chart" gallery were added so the vega_spec and chart_n artifacts can be inspected and kept. The gallery is not a step in the design.

## Process 2
- **Custom concept form:** a name plus comma-separated example values. The type is guessed from the examples (all numeric means quantitative). A name that clashes with an existing concept is rejected.
- **Trigger:** if the chart spec contains a pending custom concept, the chart area shows a notice with a "Formulate by example…" button that opens a modal.
- **Compose example_relation:** there is one column per chart concept. Custom-concept cells are seeded with the user's examples, one per row. Existing-concept cells are seeded from the table's first row in row 1 only. There are at least 2 rows, and rows can be added or removed. Cells for existing concepts get a `<datalist>` of values taken from the table. Empty cells act as wildcards.
- **Synthesizer (tool_2):** an enumerative search over a DSL I chose: `rename`, `fold` (wide→long, with key labels taken from example matches, from column names with their common prefix/suffix stripped, or from raw names), and `pivot` (long→wide, with the index set to the chart's existing concepts or to all remaining columns).
  - Candidate column sets for `fold` are: columns of the same type as the matched columns, the matched columns only, columns grouped by type, and all free columns.
  - A program is accepted if every non-empty example row appears in its output, with numeric tolerance 1e-6 and case-insensitive text matching.
  - Search is ordered by program size and capped at 6 candidates.
- **Program display:** pseudo-code (`fold(table, columns: …, key: …, value: …, labels: …)`) shown with highlighting.
- **Candidates:** a grid of cards, each with its chart, a collapsible program and a collapsible table preview, plus a "Use this result" button.
- **Assign:** the chosen table becomes a new version. Its columns become concepts, custom concepts that now exist become `reshaped`, and concepts the user had already defined keep their provenance.

## Processes 3 and 4
- **Derive form:** source concepts as toggle chips, a name field (checked against existing columns), and a description textarea. A single "Generate" button runs compose and then generate. The model step shows a loading state with a spinner and a "can take up to a minute" note.
- **llm_prompts:** 3 prompts per request, sent in parallel as one CLI call each. Each prompt is a TypeScript stub:
  - a `type Row = {…}` built from the source concepts' types
  - 6 sample rows as comments (first rows, an evenly spread sample, or an offset spread sample)
  - a doc comment with the name, sources, description and one "note" that differs per variant (simplest / literal, use `table` for cross-row logic / defensive parsing)
  - an empty `function derive(row: Row, index: number, table: Row[])`

  The system prompt requires exactly one ```typescript block with a function named `derive`, no imports, and `null` instead of throwing. The prompts can be inspected in a collapsible section.
- **Function signature:** `derive(row, index, table)`. Passing `table` allows ranks, shares and running totals.
- **Evaluation (tool_1 evaluate):**
  - The code is extracted from the reply, transpiled with `typescript.transpileModule`, and run inside a fresh `node:vm` context. The whole row loop runs inside the VM with a 5 s timeout.
  - Rows are frozen copies holding only the source columns.
  - Non-finite numbers become null. Dates become ISO dates. Objects are rejected.
  - A candidate is valid only if it runs on every row and returns at least one non-null value.
  - Identical functions are de-duplicated.
  - Failed candidates are listed separately with their errors.
- **Preview tables:** the first 8 rows, showing the source values plus the result. In refine mode they also show a "(current)" column so the old and new values can be compared.
- **Selection:** radio cards. The first valid candidate is preselected, and code is collapsible per card. "Regenerate with the same prompts" re-runs the generative step.
- **Apply:** the server runs the selected function over the full table again, then the client adds the column as a new table version. The new concept is not placed on the chart automatically; the user maps it, following the design's human specify step.
- **Refine (process 4):** "refine…" on a derived concept's card opens the same panel prefilled with the latest request. The name is locked and the sources can be edited. Generate stays disabled until the request changes. Applying replaces the column in a new version and appends the request to the concept's history.
- **Security:** `node:vm` is not a security sandbox. This is acceptable for a local single-user tool, but it is noted in the code.

## Layout and styling
- A header holds the sample picker and the file upload.
- Below it are three columns: the concept shelf (260 px), the chart builder and chart (centre), and the data table with version tabs (right). The columns in the current chart are highlighted in the data table.
- Modals are used for "Formulate by example" and "Derive / Refine".
- The look is a neutral light theme with a blue accent. Custom concepts are amber with a dashed border, derived concepts are purple, and reshaped concepts are green.

## Did the design remind me of a published system?

Yes. It closely matches **Data Formulator** (Microsoft Research; Wang, Thompson, Lee, Drucker et al., "Data Formulator: AI-powered Concept-driven Visualization Authoring", IEEE VIS 2023). The matching parts are the concept-driven authoring, custom concepts by example together with a programming-by-example reshaper, derived concepts from natural language through TypeScript prompts with several candidates, and showing code and data for inspection. I did not look it up. The following choices came from my memory of that system rather than from the design:

- **Running example and sample data:** the wide **Seattle/Atlanta temperature** table, used as the reshaping example where the user creates "City" and "Temperature" and folds the city columns.
- **Reshaping DSL:** fold (pivot-longer) and pivot (pivot-wider) as the core operators. My recollection is that Data Formulator's reshaper is built on tidyverse-style pivot operations. The exact enumeration, the matching rules and the `rename` operator are my own.
- **TypeScript prompts:** shaped as a function stub with typed inputs and a doc comment describing the new field, with several candidates kept only if they run. The design states TypeScript prompts and testing; the stub-and-doc-comment format is my recollection. The `(row, index, table)` signature and the three prompt variants are my own.
- **UI vocabulary:** the "concept shelf" and the "Formulate" wording. The visual distinction between original, custom and derived concepts on the shelf is also loosely recalled.
- **Version tabs:** keeping table versions visible is loosely inspired by my memory of the follow-up work (Data Formulator 2's "data threads"), though the design's versioned identifiers would justify it on their own.

Everything else — the stack, the layout, the prompt text, the validation rules, the sample data values, the styling and the save-chart gallery — is my own choice.
