# Plan — System X

The design (`design.json`) has four processes, no goal, no descriptions, no
representation descriptions, no references and no images. Everything below that
is not literally an expression in the design is an inferred default, taken
without waiting for confirmation (as instructed).

Reading of the design: a concept-driven visualization authoring tool. A table is
loaded, its columns become *concepts*, the user binds concepts to chart
channels and gets a Vega-Lite chart (P1). When the user binds *custom concepts*
that do not exist in the table, the system builds an *example relation* that the
user fills in, a synthesizer (tool_2) finds reshaping programs consistent with
the example, and the user picks among candidate tables/charts (P2). New concepts
can be *derived* by describing them in language; a model writes candidate code,
which is checked and previewed before the user picks one (P3). A derived
concept's request can be edited and regenerated (P4).

## Stack

- Frontend: Vite 5 + React 18 + TypeScript, Vega-Lite rendered with `vega-embed`.
- Backend: Node + Express (TypeScript via `tsx`). Hosts the only model step and
  the sandboxed code execution (`node:vm` with timeout).
- Model provider: the local Claude Code CLI (`claude -p --output-format json`,
  spawned without `CLAUDECODE` in env), behind `callModel()` in `server/model.ts`.
- Tests: Vitest for the deterministic tools (extract, translate, synthesize,
  reshape, evaluate).
- Persistence: none beyond the browser session (state in React).

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| table | `Table = { columns: string[]; rows: Row[] }`, versioned in `tableHistory` | the working dataset | `src/shared/types.ts`, `src/App.tsx` |
| concepts | `Concept[]` `{name, type, source: 'table'|'derived'|'custom', derivation?}` | fields of the table plus user concepts | `src/shared/types.ts` |
| custom_concepts | `Concept[]` with `source:'custom'` (not yet in the table) | concepts the user names before data exist for them | `src/components/ConceptPanel.tsx` |
| chart_spec | `ChartSpec = {mark, encodings: {x?, y?, color?, size?, column?, row?}}` | the encoding shelf | `src/components/EncodingShelf.tsx` |
| vega_spec | Vega-Lite JSON | produced by translate | `src/shared/translate.ts` |
| chart | rendered SVG/canvas via vega-embed | `src/components/VegaChart.tsx` |
| example_relation | `Table` with the chart_spec's fields as columns, 2 rows | `src/components/ExampleRelationEditor.tsx` |
| reshaping_programs | `ReshapeProgram[]` (pivot_longer / pivot_wider / identity, as data + display code) | `src/shared/synthesize.ts` |
| candidate_tables / candidate_charts | `Table[]` and their charts in a gallery | `src/components/CandidateGallery.tsx` |
| derivation_request | `{name, sourceConcepts: string[], description}` | `src/components/DerivationForm.tsx` |
| llm_prompts | `string[]` (3 prompt variants) | `server/derive.ts` |
| code_candidates / valid_codes / selected_code | JS function source `function derive(row, index, table)` | `server/derive.ts`, `src/components/DerivationCandidates.tsx` |
| preview_tables | `Table[]` (first rows: source columns + new column) | `server/sandbox.ts` |

## Transformations

| Process | Step | Function / component | File |
| --- | --- | --- | --- |
| P1 | tool_1 extract | `extractConcepts(table)` | `src/shared/concepts.ts` |
| P1 | human specify | drag/drop or select concepts onto `EncodingShelf` | `src/components/EncodingShelf.tsx` |
| P1 | tool_1 translate | `translateToVegaLite(spec, table)` | `src/shared/translate.ts` |
| P1 | tool_1 execute | `<VegaChart>` (vega-embed) | `src/components/VegaChart.tsx` |
| P2 | human specify (custom concepts) | "New concept" form in `ConceptPanel` | `src/components/ConceptPanel.tsx` |
| P2 | human specify (chart_spec_2) | `EncodingShelf` with a custom concept bound | `EncodingShelf.tsx` |
| P2 | tool_1 compose | `composeExampleRelation(spec, table, concepts)` | `src/shared/synthesize.ts` |
| P2 | human modify | `ExampleRelationEditor` (editable grid) | `src/components/ExampleRelationEditor.tsx` |
| P2 | tool_2 execute | `synthesizeReshapes(table, example)` (enumerative PBE) | `src/shared/synthesize.ts` |
| P2 | tool_1 execute | `runReshape(program, table)` | `src/shared/reshape.ts` |
| P2 | tool_1 translate + execute | `translateToVegaLite` per candidate + `<VegaChart>` | `CandidateGallery.tsx` |
| P2 | human select | click a candidate in `CandidateGallery` | `CandidateGallery.tsx` |
| P2 | tool_1 assign | `assignConcepts(table, concepts)` | `src/shared/concepts.ts` |
| P3 | human specify | `DerivationForm` | `src/components/DerivationForm.tsx` |
| P3 | tool_1 compose | `composeDerivationPrompts(req, table, concepts)` | `server/derive.ts` |
| P3 | model generate ~ | `generateCodeCandidates(prompts)` → `callModel` | `server/derive.ts`, `server/model.ts` |
| P3 | tool_1 evaluate | `evaluateCandidates(codes, table)` | `server/sandbox.ts` |
| P3 | human select | `DerivationCandidates` | `src/components/DerivationCandidates.tsx` |
| P3 | tool_1 execute | `POST /api/derive/apply` → `applyDerivation` | `server/sandbox.ts` |
| P3 | human specify → translate → execute | same as P1 | |
| P4 | human modify | "Edit derivation" on a derived concept reopens `DerivationForm` prefilled | `ConceptPanel.tsx`, `DerivationForm.tsx` |
| P4 | compose / generate / evaluate / select / execute | same functions as P3, replacing the column | |

## Images

None in the design.

## Open choices and defaults taken

- Layout: three columns — concepts (left), encoding shelf (middle-top) with chart (middle), data table (right/bottom).
- Number of prompt variants per derivation: 3, run in parallel.
- Code language for derivations: JavaScript, executed in `node:vm` with a 1 s timeout.
- Sample datasets bundled (a wide-format temperature table and a small cars-like table); CSV upload supported.
- Reshape DSL: pivot_longer, pivot_wider, identity (with column subset).
- No steps added beyond the design.
