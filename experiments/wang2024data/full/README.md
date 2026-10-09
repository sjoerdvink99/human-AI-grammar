# System X — visualization authoring with data concepts

Built from `design.json` (Human-AI grammar design). Load a table, put its columns (concepts) on chart channels,
create new concepts by example (reshaping via a programming-by-example synthesizer) or by natural language
(derivation functions written by a language model), inspect the intermediate code and data, and refine.

## Run

```bash
npm install
npm run dev        # API on :8787 + Vite on http://localhost:5173
# or
npm run build && npm start   # single server on http://localhost:8787
npm test           # vitest
```

Model steps call the local Claude Code CLI (`claude -p --output-format json`, launched without `CLAUDECODE`).
Set `SYSTEM_X_MODEL` to pass `--model`, or `CLAUDE_BIN` to point at another binary. To swap the provider,
replace the body of `callModel()` in `server/model.ts`.

## Design → code

| Process | Transformation | Code |
| --- | --- | --- |
| 1 | `table_1 → [tool_1 extract] → concepts_1*` | `extractConcepts()` `shared/concepts.ts`, reducer `LOAD_TABLE` `src/state.ts` |
| 1 | `[human specify] → chart_spec_1` | `ChartBuilder` `src/components/ChartBuilder.tsx` (drag concept cards or pick from menus) |
| 1 | `[tool_1 translate] → vega_spec_1` | `toVegaLite()` `shared/vega.ts` |
| 1 | `[tool_1 execute] → chart_1` | `VegaChart` `src/components/VegaChart.tsx` |
| 2 | `[human specify] → custom_concepts_1*` | "New concept by example" form, `ConceptShelf` |
| 2 | `[human specify] → chart_spec_2` | `ChartBuilder` (custom concepts are offered for channels) |
| 2 | `[tool_1 compose] → example_relation_1` | `composeExampleRelation()` `shared/synth.ts` |
| 2 | `[human modify] → example_relation_2` | `ExampleRelationEditor` `src/components/ReshapeDialog.tsx` |
| 2 | `[tool_2 execute] → reshaping_programs_1*` | `synthesize()` `shared/synth.ts`, `POST /api/reshape` |
| 2 | `[tool_1 execute] → candidate_tables_1*` | `runProgram()` / `reshape()` `shared/synth.ts` |
| 2 | `[tool_1 translate] → vega_spec_2` / `[tool_1 execute] → candidate_charts_1*` | `ReshapeCandidates` `src/components/ReshapeDialog.tsx` |
| 2 | `[human select] → table_2 + chart_2` | "Use this result" button |
| 2 | `[tool_1 assign] → concepts_2*` | `assignConcepts()` `shared/concepts.ts`, reducer `ACCEPT_RESHAPE` |
| 3 | `[human specify] → derivation_request_1` | `DerivePanel` form `src/components/DerivePanel.tsx` |
| 3 | `[tool_1 compose] → llm_prompts_1*` | `composePrompts()` `server/derive.ts`, `POST /api/derive/prompts` |
| 3 | `[model generate]~ → code_candidates_1*` | `generateCandidates()` → `callModel()` `server/model.ts`, `POST /api/derive/generate` |
| 3 | `[tool_1 evaluate] → valid_codes_1* + preview_tables_1*` | `evaluateCandidates()` `server/evaluate.ts` |
| 3 | `[human select] → selected_code_1` | candidate radio cards in `DerivePanel` |
| 3 | `[tool_1 execute] → table_3 + concepts_3*` | `POST /api/apply` → `applyCode()`; reducer `APPLY_DERIVATION` |
| 3 | `[human specify] / [tool_1 translate] / [tool_1 execute] → chart_3` | same as process 1 |
| 4 | `[human modify] → derivation_request_2` | "refine…" on a derived concept opens `DerivePanel` prefilled |
| 4 | compose / generate / evaluate / select / execute → `table_4 + concepts_4*` | same functions as process 3, `refine: true` replaces the column |

Every table version (`table_1…table_n`) is kept and selectable in the Data panel; derived concepts keep their
request history (`derivation_request_1, _2, …`).
