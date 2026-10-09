# Implementation notes

`design.json` gave only the four expressions: no name beyond "System X", no goal,
no descriptions for the system or processes, no representation descriptions, no
references and no images. Everything below was my decision.

## Interpretation

- **What the system is**: a visualization authoring tool where *concepts*
  (table fields plus user-introduced ones) are bound to chart channels. I read
  `chart_spec` as an encoding shelf, `vega_spec` as a Vega-Lite spec (the
  identifier name says so), and `chart` as its rendering.
- **How processes connect into one app**: they are not separate screens. One
  encoding shelf serves P1, P2 and P3. If every bound concept exists in the
  table, "Make chart" runs P1/P3's translate → execute. If any bound concept is
  a custom concept with no data, the button becomes "Formulate data & chart" and
  starts P2. "Derive a concept…" starts P3; "edit" on a derived concept starts P4.
- **custom_concepts**: a name plus a declared type, no data. Shown with dashed
  orange chips until a reshape gives them data.
- **example_relation**: a small editable table whose columns are the fields in
  `chart_spec_2`, 2 rows by default (add/remove rows). Fields that exist in the
  table are prefilled from the first table row; custom concepts are blank.
- **tool_2 execute (reshaping_programs*)**: an enumerative programming-by-example
  synthesizer over a three-operator DSL — `select`, `pivot_longer`,
  `pivot_wider` — with heuristics for which columns to pivot. A program is kept
  when its output on the full table contains every filled example row
  (blank cells are wildcards; numbers compared numerically, strings
  case-insensitively). Outputs are deduplicated; at most 6 programs. I treated
  `tool_2` as a distinct deterministic component (the synthesizer) from `tool_1`
  (the general data/chart runtime).
- **vega_spec_2** is one chart_spec translated once per candidate table (data is
  inlined in Vega-Lite, so each candidate gets its own spec object).
- **tool_1 assign**: re-infers types for the new table, keeps derived concepts
  whose columns survive, turns filled custom concepts into table concepts, and
  keeps still-unfilled custom concepts.
- **derivation_request**: `{name, sourceConcepts[], description}`.
- **llm_prompts***: three prompts per request, built only from table, concepts
  and request; they differ in a "Guidance" line (literal / robust to missing
  values / consider whole-table computations). Run in parallel, one CLI call each.
- **code_candidates**: JavaScript `function derive(row, index, table)` returning a
  primitive. The model is asked for one fenced code block; the backend extracts it.
- **tool_1 evaluate**: runs each candidate over all rows in `node:vm` with a 1 s
  timeout; rejects compile/runtime errors, non-primitive outputs, all-null
  outputs, and outputs identical to an earlier valid candidate. Preview tables
  show the first 8 rows of the source columns plus the new column. Rejected
  candidates are listed with their reason in a collapsed section.
- **P4**: the derivation request is stored on the derived concept, so editing it
  reopens the form prefilled (name locked) and applying replaces the column in
  place, creating a new table version.
- **Versions**: every table version (load, reshape, derive) is kept and can be
  switched to from the Data panel; every chart is kept in the Charts list and
  restores its spec and data version when clicked. New versions are appended
  even when derived from an older one (no branching UI).
- **`~` handling**: loading state on the Generate/Regenerate buttons, a
  Regenerate control, an "edit request" link, a "show prompts" toggle, output
  validation in evaluate, and human selection before anything is committed.

## Stack and libraries

- Vite 5 + React 18 + TypeScript (Vite 5 because the local Node is 20.17).
- Vega-Lite 6 / Vega 6 / vega-embed 7 for charts (SVG renderer, export action only).
- Express 5 backend run with `tsx`; papaparse for CSV upload (first 5000 rows).
- Vitest for tests. No database; state lives in the browser session.
- Model provider: Claude Code CLI, `claude -p --output-format json --tools ""
  --no-session-persistence --system-prompt …`, prompt on stdin, `CLAUDECODE`
  removed from env, 120 s timeout — all inside `callModel` in `server/model.ts`.
  `MOCK_MODEL=1` gives an offline stub used by tests.

## Layout and styling

- Three columns: concepts (left, 250 px), workspace (centre), chart list (right, 200 px).
- Centre stack: encoding shelf → active panel (chart, example editor, candidate
  gallery, derivation form, or derivation candidates) → data table.
- Encoding shelf: mark dropdown (point, bar, line, area, rect, tick, boxplot) and
  seven channels (x, y, color, size, shape, column, row), each a drop target and
  a dropdown, with an aggregate dropdown on x/y/color/size. Clicking a concept
  puts it on the first free channel.
- Concept types: quantitative / nominal / ordinal / temporal, inferred from
  values (ISO-like dates → temporal; all numeric → quantitative; else nominal).
- Neutral light theme, blue accent; custom concepts dashed orange, derived purple;
  columns used by the current chart are highlighted in the data table.
- Small regex-based syntax highlighter for code and reshaping programs.

## Data

- Two bundled samples: weekly temperatures for Seattle and Atlanta in wide
  format (generated deterministically), and a small wide student-scores table.
  Both are meant to exercise reshaping by example.

## Verification

- `npm run typecheck`, `npm test` (12 tests covering every tool step plus the model
  step with the mock provider) and `npm run build` pass.
- The real model step was exercised once through `POST /api/derive/candidates`
  with the Claude CLI: three candidates came back, one valid, two flagged as
  duplicates of its output.
- Vega-Lite compilation of translated specs was checked for every mark.
- I did not drive the UI in a browser (no browser automation was available in
  this session), so the interactive flows were checked by type checking and by
  testing the functions they call, not by clicking through.

## Did the design remind me of a published system?

Yes — strongly of **Data Formulator** (Wang, Thompson, Lee, Drucker, Lin et al.,
Microsoft Research, IEEE VIS 2023): concept-driven visualization authoring
where users bind data concepts to a Vega-Lite encoding shelf, define new
concepts that are not in the table, supply an example relation for reshaping
that a programming-by-example synthesizer turns into candidate transformations,
and derive concepts with natural language handled by an LLM that writes
candidate code, filtered and previewed before the user picks one.

Choices that came from that knowledge rather than from the design:

- Naming/framing of "concepts" with the three kinds (from the table, derived,
  custom/"unknown"), and the single shelf that switches to the example flow when
  a custom concept is bound.
- Restricting tool_2's DSL to pivot_longer / pivot_wider style reshaping (the
  design only says "reshaping programs").
- The sample dataset of Seattle vs. Atlanta temperatures in wide format — this
  is the running example I remember from the paper.
- Asking for multiple code candidates and deduplicating them by output, and
  storing the derivation (description + source concepts + code) on the concept so
  it can be edited later.
- Using Vega-Lite and showing candidate charts in a gallery to pick from.

Choices that did **not** come from the original (as far as I recall): JavaScript
rather than TypeScript/Python for derivations, the three prompt "guidance"
variants, the node:vm sandbox, the version selector, aggregate dropdowns, and
the overall visual layout.
