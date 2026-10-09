# System X — from learning content to an interactive simulation

Implementation of the Human-AI grammar design in [`design.json`](design.json).
A teacher pastes learning content; the app builds a concept graph, proposes scenarios and
learning goals, designs an experiment and a UI graph, generates an HTML/JS simulation, verifies and
repairs it in a headless browser, and then lets the teacher refine it through tests, region chat,
assumption editing, sketch-based redraw and region→graph lookup.

## Run

Requirements: Node 20+, the Claude Code CLI (`claude`) logged in, Playwright Chromium
(`npx playwright install chromium` if missing).

```bash
npm install
npm run dev          # server on :8931, web on http://localhost:5317
npm test             # unit tests for the deterministic tools (graph diff, parsing, headless runner)
npm run typecheck
npx tsx scripts/e2e.ts /tmp/out   # walk through all 8 processes against a running server (real model calls)
```

Optional env: `CLAUDE_MODEL` (e.g. `sonnet`) to pick the CLI model, `MODEL_TIMEOUT_MS`.

## Model provider

Every model operation goes through one function, `callModel()` in `server/model.ts`, which runs
`claude -p --output-format json` with `CLAUDECODE` removed from the environment. Images (sketches,
test screenshots) are written to a temp dir and the model is allowed to `Read` them. Swap the body of
`callModel()` to change provider. Outputs are validated (zod schemas, HTML/SVG checks, id checks) and
retried once with the validation error fed back (`modelWith()` in `server/ops.ts`).

## Design → code map

| process | transformation | code |
|---|---|---|
| 1 | `[model translate]` learning_content → concept_graph | `server/ops.ts` `translateConceptGraph`; UI `src/views/Authoring.tsx` §1 |
| 1 | `[model generate]` → scenarios* | `generateScenarios`; Authoring §2 |
| 1 | `[human select]` → scenario | scenario cards, Authoring §3 |
| 1 | `[model translate]` → scenario_graph | `translateScenarioGraph` |
| 1 | `[model generate]` → learning_goals* | `generateLearningGoals` |
| 1 | `[human select]` → learning_goal | goal cards, Authoring §4 |
| 1 | `[model select]` → learning_goal_graph | `selectLearningGoalGraph` (model picks ids, code builds the sub-graph) |
| 1 | `[model extract]` → experiment_factors | `extractExperimentFactors` |
| 1 | `[model generate]` → procedure | `generateProcedure` |
| 1 | `[model generate]` → ui_graph | `generateUiGraph` |
| 1 | `[model translate]` → simulation_code_1 | `translateSimulationCode`; chain in `src/lib/pipeline.ts` `runGoalChain` |
| 2 | `[human modify]` concept_graph_1 → concept_graph_2 | `src/components/GraphEditor.tsx` |
| 3 | `[tool_2 execute]` → javascript_errors* | `server/headless.ts` `loadAndCollectErrors` (Playwright) |
| 3 | `[model modify]` → simulation_code_2 | `fixJavascriptErrors` |
| 3 | `[model generate]` → test_cases* | `generateTestCases` |
| 3 | `[tool_2 execute]` → test_results* + test_screenshots* | `headless.ts` `runTests` |
| 3 | `[model evaluate]` → test_assessment | `evaluateTests` (reads screenshots) |
| 3 | `[model modify]` → simulation_code_3 | `repairFromAssessment`; chain `pipeline.ts` `runVerify` |
| 3 | `[tool_1 execute]` → simulation | `src/components/SimulationFrame.tsx` (sandboxed iframe) |
| 4 | `[human select]` → ui_test | `src/views/panels/TestsPanel.tsx` |
| 4 | `[tool_1 execute]` → ui_test_result | injected runner in `SimulationFrame.tsx` (`runTest`) |
| 4 | `[human evaluate]` → ui_test_feedback | verdict buttons in `TestsPanel` |
| 4 | `[model select]` → repair_target_1 | `selectRepairTarget` |
| 4 | `[model generate]` → suggested_repair | `suggestRepair` |
| 4 | `[human select]` → approved_repair | `src/views/panels/ApproveList.tsx` |
| 4 | `[model modify]` → simulation_code_guided_4 | `applyApprovedChange` |
| 5 | `[human select]` → chat_region | `src/components/RegionOverlay.tsx` + `elementsInRect` |
| 5 | `[human specify]` → issue | `src/views/panels/ChatPanel.tsx` |
| 5 | `[model select]` → repair_target_2 | `selectRepairTarget` |
| 5 | `[model generate]` → suggested_change | `suggestChange` (includes UI-graph edits) |
| 5 | `[human select]` → approved_change | `ApproveList.tsx` |
| 5 | `[tool_1 modify]` → ui_graph_2 | `src/lib/graphDiff.ts` `applyGraphChanges` |
| 5 | `[model modify]` → simulation_code_chat_4 | `regenerateFromUiGraph` |
| 6 | `[human select]` → selected_node | UI-graph click in `src/views/Workspace.tsx` |
| 6 | `[model extract]` → assumptions_1 | `extractAssumptions`; `src/views/panels/AssumptionsPanel.tsx` |
| 6 | `[human modify]` → assumptions_2 | editable table in `AssumptionsPanel` |
| 6 | `[model modify]` → simulation_code_assumptions_4 | `applyAssumptions` |
| 7 | `[human select]` → redraw_region | `RegionOverlay` |
| 7 | `[human specify]` → sketch | `src/components/SketchCanvas.tsx` |
| 7 | `[model translate]` → replacement_svg | `sketchToSvg` |
| 7 | `[model modify]` → simulation_code_redrawn_4 | `integrateSvg`; `src/views/panels/RedrawPanel.tsx` |
| 7 | `[tool_1 execute]` → redrawn_simulation | `SimulationFrame` renders the new version |
| 8 | `[human select]` → subgraph_region | `RegionOverlay` |
| 8 | `[model match]` → subgraph | `matchSubgraph`; highlighted in the UI graph (`src/views/panels/FindPanel.tsx`) |

HTTP endpoints for each step are in `server/index.ts` (`/api/p<process>/<step>`).
