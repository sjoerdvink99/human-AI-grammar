# System X — interactive simulation authoring for teachers

Built from `design.json` (Human-AI grammar design, 8 processes). A teacher enters learning content; a
language model turns it into a chain of editable graphs (concept → scenario → learning goal → UI) and
then into a runnable HTML simulation, which is tested automatically in a headless browser and can be
corrected through guided tests, chat with region marking, assumption editing, sketch-based redrawing,
and region-to-subgraph inspection.

## Run

Requirements: Node 20+, the `claude` CLI logged in, Playwright Chromium (`npx playwright install chromium`).

```bash
npm install
npm run dev        # API on :8642, UI on http://localhost:5173
# or
npm run build && npm start   # single server on http://localhost:8642
```

`npm run typecheck`, `npm test` (vitest; graph ops + headless browser tool).
Set `SYSTEMX_MODEL=sonnet` (any `claude --model` value) to choose the model.

## Architecture

| Piece | File |
| --- | --- |
| Model provider boundary (`callModel`, Claude Code CLI, `CLAUDECODE` removed) | `server/model.ts` |
| Model operations (one prompt per design operation, zod-validated) | `server/ops.ts` |
| tool_2 headless browser (Playwright) | `server/browser.ts` |
| HTTP: `POST /api/op/<operation>` | `server/index.ts` |
| Representation types | `shared/types.ts`, `src/project.ts` |
| tool_1 browser runtime (iframe, test playback, region → DOM elements) | `src/components/SimulationView.tsx`, `src/lib/runner.ts` |

## Design → code

| Process | Step | Implementation |
| --- | --- | --- |
| 1 Generate | [model translate]~ learning_content → concept_graph | `translateConceptGraph` (`server/ops.ts`), triggered by *Generate concept graph* in `GeneratePanel.tsx` |
| 1 | [model generate]~ → scenarios* | `generateScenarios` (runs automatically after the concept graph) |
| 1 | [human select] scenario | radio list + *Use scenario* (`GeneratePanel.tsx`) |
| 1 | [model translate]~ → scenario_graph | `translateScenarioGraph` |
| 1 | [model generate]~ → learning_goals* | `generateLearningGoals` |
| 1 | [human select] learning_goal | radio list + *Use goal & build simulation* |
| 1 | [model select] → learning_goal_graph | `selectLearningGoalGraph` (subset of scenario graph enforced in code) |
| 1 | [model extract] → experiment_factors | `extractExperimentFactors` |
| 1 | [model generate]~ → procedure | `generateProcedure` |
| 1 | [model generate]~ → ui_graph | `generateUiGraph` |
| 1 | [model translate]~ → simulation_code_1 | `translateSimulationCode` |
| 2 Refine graph | [human modify] concept_graph_1 → concept_graph_2 | `GraphEditor.tsx` (add/remove/rename nodes and links, *Save as vN*); same editor for every graph |
| 3 Auto test | [tool_2 execute] → javascript_errors* | `runForErrors` (`server/browser.ts`), started automatically by `runAutomatedTesting` (`App.tsx`) |
| 3 | [model modify]~ → simulation_code_2 | `fixJavascriptErrors` (up to 2 rounds, only when errors exist) |
| 3 | [model generate]~ → test_cases* | `generateTestCases` |
| 3 | [tool_2 execute] → test_results* + test_screenshots* | `runTests` |
| 3 | [model evaluate]~ → test_assessment | `evaluateTestResults` (screenshots attached as images) |
| 3 | [model modify]~ → simulation_code_3 | `repairFromAssessment` (only when the goal is not met) |
| 3 | [tool_1 execute] → simulation | iframe in `SimulationView.tsx`; results in *Auto tests* tab (`TestsPanel`) |
| 4 Guided test | [human select] ui_test → [tool_1 execute] | `GuidedTestPanel` + `playTestInIframe` (`src/lib/runner.ts`) |
| 4 | [human evaluate] → ui_test_feedback | feedback buttons (`GuidedTestPanel`) |
| 4 | [model select] → repair_target | `selectRepairTarget` |
| 4 | [model generate]~ → suggested_repair | `generateSuggestedRepair` |
| 4 | [human select] → approved_repair | *Approve & update code* / *Reject* |
| 4 | [model modify]~ → simulation_code_guided | `applyRepairToCode` |
| 5 Chat | [human select] chat_region | *Circle problem area* + freehand overlay (`SimulationView.tsx`) |
| 5 | [human specify] issue | chat box (`ChatPanel`) |
| 5 | [model select] → repair_target | `selectRepairTargetForIssue` (annotated screenshot attached) |
| 5 | [model generate]~ → suggested_change | `generateSuggestedChange`, shown as an editable operations widget |
| 5 | [human select] → approved_change | *Accept change* |
| 5 | [tool_1 modify] → ui_graph_2 | `applyGraphOps` (`src/lib/graph.ts`) |
| 5 | [model modify]~ → simulation_code_chat | `reviseCodeForGraph` |
| 6 Assumptions | [human select] node in UI Graph | node click in `GraphEditor` (UI Graph tab) |
| 6 | [model extract] → assumptions | `extractAssumptions` (`AssumptionsPanel`) |
| 6 | [human modify] → assumptions_2 | assumptions text widget |
| 6 | [model modify]~ → simulation_code_assumptions | `reviseCodeForAssumptions` |
| 7 Redraw | [human select] redraw_region | *Circle graphic to replace* (`RedrawPanel`) |
| 7 | [human specify] sketch | `SketchPad.tsx` |
| 7 | [model translate]~ → replacement_svg | `translateSketchToSvg` (SVG validated) |
| 7 | [model modify]~ → simulation_code_redrawn | `replaceGraphic` |
| 7 | [tool_1 execute] → redrawn_simulation | iframe reload |
| 8 Inspect | [human select] subgraph_region | *Subgraph selector* (`InspectPanel`) |
| 8 | [model match] → subgraph | `matchSubgraph`; highlighted in the UI Graph view |
