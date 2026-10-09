# PLAN — System X (simulation authoring for teachers)

Design: `design.json` (8 processes, no references, no images).
Confirmation was not awaited (controlled experiment); the recommended defaults below were taken.

## Stack (repository was empty)

| Concern | Choice |
| --- | --- |
| Frontend | Vite + React 18 + TypeScript, single page, plain CSS |
| Graph views / editing | `@xyflow/react` (node-link view, add/remove/rename nodes and links) with a small layered auto-layout |
| Backend | Node + Express (TypeScript via `tsx`) |
| Model | `callModel()` in `server/model.ts` — the only place that talks to a provider; spawns `claude -p --output-format json` with `CLAUDECODE` removed; `--json-schema` for records, images passed as files read via the `Read` tool |
| tool_2 (headless browser) | Playwright Chromium in `server/browser.ts` |
| tool_1 (browser runtime) | sandboxed `<iframe srcdoc>` in the client + an injected test runner |
| Validation | `zod` on every model output, plus code checks (graph ids, subset constraints, SVG well-formedness) |
| Persistence | project state in `localStorage`, export/import JSON; server is stateless |

## Representations

| id | type (TS) | contents | file |
| --- | --- | --- | --- |
| learning_content | `string` | topic/text to teach | `src/types.ts` |
| concept_graph | `Graph` (nodes,id,label,type; edges,id,source,target,label) versioned | concepts + relations | `src/types.ts` |
| scenarios | `string[]` | suggested teaching scenarios | |
| scenario | `string` | picked scenario | |
| scenario_graph | `Graph` | objects + relations in scenario | |
| learning_goals | `string[]` | suggested goals | |
| learning_goal | `string` | picked goal | |
| learning_goal_graph | `Graph` (subset of scenario_graph, enforced) | relevant part | |
| experiment_factors | `{independent[], dependent[], controlled[]}` | variables to change/observe | |
| procedure | `string` (numbered steps) | experiment steps | |
| ui_graph | `Graph` (node types: control, display, visual, logic, container) | interface elements & connections | |
| simulation_code | `CodeVersion[]` history (`html`, `label`, `origin`) | single self-contained HTML doc | |
| javascript_errors | `string[]` | runtime/page errors | |
| test_cases | `TestCase[]` {id,title,purpose,steps[],expected,needs_human_check} | interaction tests | |
| test_results | `TestResult[]` {test_id,passed,observations,error} | | |
| test_screenshots | `string[]` (data URLs) | | |
| test_assessment | `{meets_goal, summary, problems[]}` | | |
| simulation | rendered iframe | running simulation | `src/components/SimulationView.tsx` |
| ui_test / ui_test_result | selected TestCase / playback log + iframe | | |
| ui_test_feedback | categorical: `as_expected` `no_response` `wrong_behavior` `wrong_visual` `layout_problem` | | |
| repair_target | categorical: `concept_graph` `scenario_graph` `learning_goal_graph` `ui_graph` `code` | | |
| suggested_repair / approved_repair | `{level, summary, details}` | | |
| chat_region / redraw_region / subgraph_region | `Region` {points[], bbox, elements[]} | freehand stroke over the simulation | |
| issue | `string` | chat message | |
| suggested_change / approved_change | `{level, summary, operations: GraphOp[]}` (editable) | | |
| selected_node | node id | | |
| assumptions | `{id,text}[]` versioned | | |
| sketch | PNG data URL | | |
| replacement_svg | `string` (validated SVG) | | |
| subgraph | `{nodeIds, edgeIds}` | highlighted in UI graph | |

## Transformations

| # | actor op | function / component | file |
| --- | --- | --- | --- |
| P1 | model translate content→concept_graph | `translateConceptGraph` | `server/ops.ts` |
| P1 | model generate scenarios | `generateScenarios` | `server/ops.ts` |
| P1 | human select scenario | `ChoiceList` in `GeneratePanel` | `src/components/GeneratePanel.tsx` |
| P1 | model translate →scenario_graph | `translateScenarioGraph` | `server/ops.ts` |
| P1 | model generate learning_goals | `generateLearningGoals` | |
| P1 | human select goal | `ChoiceList` | |
| P1 | model select learning_goal_graph | `selectLearningGoalGraph` | |
| P1 | model extract experiment_factors | `extractExperimentFactors` | |
| P1 | model generate procedure | `generateProcedure` | |
| P1 | model generate ui_graph | `generateUiGraph` | |
| P1 | model translate →simulation_code | `translateSimulationCode` | |
| P2 | human modify graph | `GraphEditor` (any graph) | `src/components/GraphEditor.tsx` |
| P3 | tool_2 execute (errors) | `runForErrors` | `server/browser.ts` |
| P3 | model modify (fix errors) | `fixJavascriptErrors` | `server/ops.ts` |
| P3 | model generate test_cases | `generateTestCases` | |
| P3 | tool_2 execute tests | `runTests` | `server/browser.ts` |
| P3 | model evaluate | `evaluateTestResults` | `server/ops.ts` |
| P3 | model modify (when not met) | `repairFromAssessment` | |
| P3 | tool_1 execute | `SimulationView` iframe | `src/components/SimulationView.tsx` |
| P4 | human select ui test | `GuidedTestPanel` | `src/components/GuidedTestPanel.tsx` |
| P4 | tool_1 execute playback | `playTestInIframe` | `src/lib/runner.ts` |
| P4 | human evaluate | feedback buttons | `GuidedTestPanel` |
| P4 | model select repair_target | `selectRepairTarget` | `server/ops.ts` |
| P4 | model generate suggested_repair | `generateSuggestedRepair` | |
| P4 | human select (approve) | approve/reject in `GuidedTestPanel` | |
| P4 | model modify → simulation_code_guided | `applyRepairToCode` | |
| P5 | human select chat_region | `RegionOverlay` mode `chat` | `src/components/RegionOverlay.tsx` |
| P5 | human specify issue | `ChatPanel` | `src/components/ChatPanel.tsx` |
| P5 | model select repair_target | `selectRepairTarget` (region variant) | |
| P5 | model generate suggested_change | `generateSuggestedChange` | |
| P5 | human select (accept edited change) | editable widget in `ChatPanel` | |
| P5 | tool_1 modify ui_graph | `applyGraphOps` | `src/lib/graph.ts` |
| P5 | model modify → simulation_code_chat | `reviseCodeForGraph` | |
| P6 | human select node | click in UI graph `GraphEditor` | |
| P6 | model extract assumptions | `extractAssumptions` | |
| P6 | human modify assumptions | `AssumptionsPanel` textarea | `src/components/AssumptionsPanel.tsx` |
| P6 | model modify → simulation_code_assumptions | `reviseCodeForAssumptions` | |
| P7 | human select redraw_region | `RegionOverlay` mode `redraw` | |
| P7 | human specify sketch | `SketchPad` | `src/components/SketchPad.tsx` |
| P7 | model translate sketch→SVG | `translateSketchToSvg` | |
| P7 | model modify → simulation_code_redrawn | `replaceGraphic` | |
| P7 | tool_1 execute | iframe reload | |
| P8 | human select subgraph_region | `RegionOverlay` mode `inspect` | |
| P8 | model match → subgraph | `matchSubgraph` | |

## Open choices (defaults taken)
- Layout: left = authoring pipeline (process 1 steps as stacked cards), centre = tabbed graph view (concept / scenario / goal / UI) with editor, right = simulation + tool tabs (Tests, Guided test, Chat, Assumptions, Redraw, Inspect).
- Process 3 runs automatically right after code generation; error-fix loop max 2 rounds; assessment-driven repair 1 round.
- Code versions kept as a history with revert; every later process starts from the current version.
