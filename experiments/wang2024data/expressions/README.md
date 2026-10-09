# System X — concept-driven charts

A web app built from `design.json` (Human-AI grammar design, four processes).
Load a table, bind its concepts to chart channels, reshape the data by example
when a chart needs concepts the table does not have, and derive new concepts by
describing them in words (a model writes candidate code; you pick one).

## Run

```bash
npm install
npm run dev        # API on :3001 + Vite on :5173 → open http://localhost:5173
# or
npm run build && npm start   # single server on :3001
npm test           # Vitest: deterministic tools + model step with a mock provider
npm run typecheck
```

The model step uses the local Claude Code CLI (`claude -p --output-format json`,
started without `CLAUDECODE`). Swap the provider in `server/model.ts`
(`callModel`). Env: `CLAUDE_BIN`, `CLAUDE_MODEL`, `MOCK_MODEL=1` (offline stub).

## Design → code

| Process | Transformation | Code |
| --- | --- | --- |
| 1 | `[tool_1 extract]` table → concepts | `extractConcepts` — `src/shared/concepts.ts` (called in `load`, `src/App.tsx`) |
| 1, 3 | `[human specify]` chart_spec | `EncodingShelf` — `src/components/EncodingShelf.tsx` |
| 1, 2, 3 | `[tool_1 translate]` → vega_spec | `translateToVegaLite` — `src/shared/translate.ts` |
| 1, 2, 3 | `[tool_1 execute]` → chart | `VegaChart` (vega-embed) — `src/components/VegaChart.tsx` |
| 2 | `[human specify]` custom_concepts | "New concept" form — `src/components/ConceptPanel.tsx` |
| 2 | `[human specify]` chart_spec_2 | `EncodingShelf` with a custom concept bound → "Formulate data & chart" |
| 2 | `[tool_1 compose]` → example_relation | `composeExampleRelation` — `src/shared/synthesize.ts` |
| 2 | `[human modify]` example_relation | `ExampleRelationEditor` — `src/components/ExampleRelationEditor.tsx` |
| 2 | `[tool_2 execute]` → reshaping_programs* | `synthesizeReshapes` — `src/shared/synthesize.ts` |
| 2 | `[tool_1 execute]` → candidate_tables* | `runReshape` — `src/shared/reshape.ts` |
| 2 | `[human select]` → table_2 + chart_2 | `CandidateGallery` — `src/components/CandidateGallery.tsx`; `selectCandidate` in `App.tsx` |
| 2 | `[tool_1 assign]` → concepts_2 | `assignConcepts` — `src/shared/concepts.ts` |
| 3 | `[human specify]` derivation_request | `DerivationForm` — `src/components/DerivationForm.tsx` |
| 3, 4 | `[tool_1 compose]` → llm_prompts* | `composeDerivationPrompts` — `server/derive.ts` |
| 3, 4 | `[model generate]~` → code_candidates* | `generateCodeCandidates` → `callModel` — `server/derive.ts`, `server/model.ts` |
| 3, 4 | `[tool_1 evaluate]` → valid_codes* + preview_tables* | `evaluateCandidates` — `server/sandbox.ts` |
| 3, 4 | `[human select]` → selected_code | `DerivationCandidates` — `src/components/DerivationCandidates.tsx` |
| 3, 4 | `[tool_1 execute]` → table_3 / table_4 | `applyDerivation` — `server/sandbox.ts` (`POST /api/derive/apply`) |
| 4 | `[human modify]` derivation_request_1 → _2 | "edit" on a derived concept reopens `DerivationForm` prefilled |

Table versions (table_1 … table_4) are kept in the "Data" version selector; charts
(chart_1 … chart_3) are kept in the "Charts" list on the right.
