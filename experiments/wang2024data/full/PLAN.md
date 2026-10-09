# PLAN — System X (visualization authoring with data concepts)

Design: `design.json` (4 processes, no references, no images).
Per the experiment instructions, the recommended defaults below were taken without waiting for confirmation.

## Stack (repository was empty)

| Concern | Choice |
| --- | --- |
| Frontend | Vite + React 18 + TypeScript, no UI framework, plain CSS |
| State | one React `useReducer` store (`src/state.ts`) whose fields are named after design identifiers |
| Charts | Vega-Lite 5 rendered with `vega-embed` |
| Backend | Node + Express (TypeScript via `tsx`) — "data transformation backend" of tool_1 |
| Model | `claude -p --output-format json` spawned without `CLAUDECODE`, behind `callModel()` in `server/model.ts` |
| Code execution | TypeScript transpiled with `typescript.transpileModule`, run in `node:vm` with a timeout |
| PBE synthesizer (tool_2) | own enumerative synthesizer over a small reshaping DSL (`shared/synth.ts`) |
| Tests | Vitest for synthesizer, evaluation, vega translation |
| Persistence | in-memory in the browser session (no database); tables loaded from CSV/JSON upload or bundled samples |

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| table | `Table = {id, version, name, rows: Row[], columns: string[]}`; history kept as `tables[]` | the working data table; versions 1→4 add/reshape columns | `shared/types.ts`, `src/state.ts` |
| concepts* | `Concept[]` `{name, type: quantitative/nominal/temporal/ordinal, source: original/custom/derived, ...}` | fields available for charts | `shared/types.ts`, `src/concepts.ts` |
| custom_concepts* | `Concept` with `source:'custom'`, `examples: string[]`, not yet in the table | user-named concepts with example values | `src/components/ConceptShelf.tsx` |
| chart_spec | `ChartSpec {mark, encodings: {x,y,color,size,shape,column}}` | chart type + concept per channel | `src/components/ChartBuilder.tsx` |
| vega_spec | Vega-Lite JSON object | spec of the chart | `shared/vega.ts` |
| chart | rendered Vega view (SVG) | rendered chart | `src/components/VegaChart.tsx` |
| example_relation | `{columns: string[], rows: string[][]}` | small editable table, one column per chart concept | `src/components/ExampleRelationEditor.tsx` |
| reshaping_programs* | `Program` AST + pretty-printed code | programs that reshape the table to contain the chart's concepts | `shared/synth.ts` |
| candidate_tables* | `Row[][]` | output of each program | `shared/synth.ts` |
| candidate_charts* | Vega views | one per candidate table | `src/components/ReshapeCandidates.tsx` |
| derivation_request | `{sources: string[], name, description}` (versioned 1→2) | the NL derivation request | `src/components/DerivePanel.tsx` |
| llm_prompts* | strings (TypeScript-context prompts) | prompts sent to the model | `server/derive.ts` |
| code_candidates* | TypeScript source strings | functions returned by the model | `server/derive.ts` |
| valid_codes* | subset of code_candidates that run on every row | | `server/evaluate.ts` |
| preview_tables* | first rows: source values + result, one per valid code | | `server/evaluate.ts` |
| selected_code | the chosen function | | `src/components/DerivePanel.tsx` |

## Transformations

| Process | Step | Actor op | Implementation |
| --- | --- | --- | --- |
| 1 | load → concepts | tool_1 extract | `extractConcepts()` `src/concepts.ts` (type inference) |
| 1 | pick chart type + channels | human specify | `ChartBuilder` (mark buttons, channel drop zones / menus) |
| 1 | chart_spec → vega_spec | tool_1 translate | `toVegaLite()` `shared/vega.ts` |
| 1 | vega_spec → chart | tool_1 execute | `VegaChart` (vega-embed) |
| 2 | name custom concept + examples | human specify | "New concept → by example" form in `ConceptShelf` |
| 2 | map onto channels | human specify | `ChartBuilder` (custom concepts are droppable) |
| 2 | build example table | tool_1 compose | `composeExampleRelation()` `shared/synth.ts` |
| 2 | fill example table | human modify | `ExampleRelationEditor` |
| 2 | synthesize programs | tool_2 execute | `synthesize()` `shared/synth.ts`, via `POST /api/reshape` |
| 2 | run programs | tool_1 execute | `runProgram()` `shared/synth.ts` |
| 2 | spec per candidate | tool_1 translate | `toVegaLite()` |
| 2 | render candidates | tool_1 execute | `ReshapeCandidates` |
| 2 | choose candidate | human select | "Use this result" button |
| 2 | new concepts available | tool_1 assign | `assignConcepts()` `src/concepts.ts` (reducer `ACCEPT_RESHAPE`) |
| 3 | sources + name + description | human specify | `DerivePanel` form |
| 3 | prompts | tool_1 compose | `composePrompts()` `server/derive.ts` |
| 3 | functions | model generate~ | `callModel()` `server/model.ts`, parallel, `POST /api/derive` |
| 3 | test functions | tool_1 evaluate | `evaluateCandidates()` `server/evaluate.ts` |
| 3 | pick function | human select | candidate cards in `DerivePanel` |
| 3 | apply | tool_1 execute | `POST /api/apply` → `applyCode()` `server/evaluate.ts` |
| 3 | map new concept | human specify / translate / execute | same as process 1 |
| 4 | edit description | human modify | "Edit derivation" on a derived concept card → `DerivePanel` prefilled (request v2) |
| 4 | prompts / generate / evaluate / select / execute | same functions as process 3 | column replaced in place, new table version |

## Open choices and defaults taken

- Provider: Claude Code CLI, 3 prompts per request in parallel (prompt variants differ in emphasis and example rows).
- Persistence: in-browser only, every table version kept in a version list and selectable.
- Layout: three columns — concept shelf (left), chart builder + chart (center), data table with version tabs (right/bottom); dialogs for example relation and candidates.
- Synthesizer DSL: `rename`, `fold` (wide→long), `pivot` (long→wide), each followed by `select`; enumerated by size, checked against example rows.
- Derived function signature: `derive(row, index, table)`.
