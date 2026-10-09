# PLAN — System X (simulation authoring from learning content)

The design has no goal, descriptions, representation descriptions, references or images.
Everything below about *contents* is inferred from identifiers and process structure; per the
experiment instructions the recommended default is taken for every open choice without waiting.

Inferred purpose: a teacher pastes learning content; the system builds a concept graph, proposes
real-world scenarios, then learning goals, plans an experiment, designs a UI graph and generates an
interactive HTML/JS educational simulation. The simulation is then automatically verified and
repaired (headless browser), and the teacher refines it through tests, region chat, assumption
editing, sketch redraw, and region→graph lookup.

## Stack (empty repo → minimal stack)

- Vite + React + TypeScript frontend (`src/`), Express + TypeScript backend (`server/`, run with `tsx`).
- Model provider: local Claude Code CLI (`claude -p --output-format json`, `CLAUDECODE` removed),
  behind one function `callModel()` in `server/model.ts`.
- `tool_2` (headless execution): Playwright Chromium in `server/headless.ts`.
- `tool_1` (live execution / modify): sandboxed `<iframe srcdoc>` in the browser + deterministic graph-diff code.
- Graph layout: `@dagrejs/dagre` + custom SVG rendering. Validation: `zod`.
- Persistence: client state in `localStorage` (single project); no database.

## Representations

| id | type | contents | file |
|---|---|---|---|
| learning_content | `string` | pasted text of a lesson/textbook passage | `src/types.ts` |
| concept_graph (v1, v2) | `Graph` | concept nodes `{id,label,description}` + relation edges `{source,target,label}` | `src/types.ts` |
| scenarios | `string[]` | 4 real-world scenarios that illustrate the concepts | `src/types.ts` |
| scenario | `string` | the chosen scenario | |
| scenario_graph | `Graph` | entities / variables / processes of the scenario and their relations | |
| learning_goals | `string[]` | 4 candidate learning goals for that scenario | |
| learning_goal | `string` | the chosen goal | |
| learning_goal_graph | `Graph` | sub-graph of scenario_graph relevant to the goal (model picks node ids, code validates) | |
| experiment_factors | `ExperimentFactors` | independent / dependent / controlled variables with units, ranges | |
| procedure | `string` | numbered steps of the experiment a learner performs | |
| ui_graph (v1, v2) | `Graph` with `kind` | UI components (control, display, visual, container, logic) and data-flow edges | |
| simulation_code (1,2,3, guided_4, chat_4, assumptions_4, redrawn_4) | `CodeVersion` | single self-contained HTML document; elements carry `data-ui-node` ids | |
| javascript_errors | `string[]` | runtime errors from headless load | |
| test_cases | `TestCase[]` | `{id,title,purpose,steps[{action,selector,value}],expected}` | |
| test_results | `TestResult[]` | `{test_id,step_errors,console_errors,visible_text}` | |
| test_screenshots | `string[]` | PNG data URLs, one per test | |
| test_assessment | `string` | model critique of results | |
| simulation | visual | live iframe rendering of current code | `src/components/SimulationFrame.tsx` |
| ui_test | `TestCase` | the test case the human picks | |
| ui_test_result | visual | iframe after running the steps live | |
| ui_test_feedback | `'works'|'partially_works'|'broken'` | human verdict | |
| repair_target (1,2) | one of `layout, visual_rendering, controls, simulation_logic, data_display, text_labels` | | `src/types.ts` |
| suggested_repair / suggested_change | `SuggestedChange` | `{target,summary,changes[],ui_graph_changes?}` | |
| approved_repair / approved_change | same, filtered by human checkboxes | | |
| chat_region / redraw_region / subgraph_region | `Region {x,y,w,h}` + elements inside it | | |
| issue | `string` | human description of the problem | |
| selected_node | `string` (node id of ui_graph) | | |
| assumptions (v1, v2) | `Assumptions` `{node_id, items[{name,value,rationale}]}` | | |
| sketch | PNG data URL | freehand drawing over the region | |
| replacement_svg | `string` | SVG markup | |
| subgraph | `string[]` node ids of ui_graph | | |

## Transformations

| process | step | actor op | implementation |
|---|---|---|---|
| 1 | learning_content → concept_graph | model translate | `POST /api/p1/concept-graph` (`server/ops.ts: translateConceptGraph`) |
| 1 | → scenarios | model generate | `generateScenarios` |
| 1 | pick scenario | human select | `ScenarioPicker` in `src/views/Authoring.tsx` |
| 1 | scenario → scenario_graph | model translate | `translateScenarioGraph` |
| 1 | → learning_goals | model generate | `generateLearningGoals` |
| 1 | pick goal | human select | `Authoring.tsx` |
| 1 | → learning_goal_graph | model select | `selectLearningGoalGraph` (+ code builds subgraph) |
| 1 | → experiment_factors | model extract | `extractExperimentFactors` |
| 1 | → procedure | model generate | `generateProcedure` |
| 1 | → ui_graph | model generate | `generateUiGraph` |
| 1 | → simulation_code_1 | model translate | `translateSimulationCode` |
| 2 | concept_graph_1 → _2 | human modify | `GraphEditor` in Authoring step 1 |
| 3 | → javascript_errors | tool_2 execute | `server/headless.ts: loadAndCollectErrors` |
| 3 | → simulation_code_2 | model modify | `fixJavascriptErrors` |
| 3 | → test_cases | model generate | `generateTestCases` |
| 3 | → test_results + screenshots | tool_2 execute | `headless.ts: runTests` |
| 3 | → test_assessment | model evaluate | `evaluateTests` |
| 3 | → simulation_code_3 | model modify | `repairFromAssessment` |
| 3 | → simulation | tool_1 execute | `SimulationFrame` |
| 4 | pick test | human select | `TestsPanel` |
| 4 | → ui_test_result | tool_1 execute | iframe runner (`src/sim/runner.ts`) |
| 4 | verdict | human evaluate | works / partially / broken buttons |
| 4 | → repair_target_1 | model select | `selectRepairTarget` |
| 4 | → suggested_repair | model generate | `suggestRepair` |
| 4 | approve | human select | checkbox list + Apply |
| 4 | → simulation_code_guided_4 | model modify | `applyApprovedChange` |
| 5 | drag region | human select | `RegionOverlay` |
| 5 | type issue | human specify | `ChatPanel` |
| 5 | → repair_target_2 | model select | `selectRepairTarget` |
| 5 | → suggested_change | model generate | `suggestChange` (includes ui_graph diff) |
| 5 | approve | human select | checkboxes |
| 5 | → ui_graph_2 | tool_1 modify | `src/lib/graphDiff.ts: applyGraphChanges` |
| 5 | → simulation_code_chat_4 | model modify | `regenerateFromUiGraph` |
| 6 | click UI node | human select | `GraphView` in `NodePanel` |
| 6 | → assumptions_1 | model extract | `extractAssumptions` |
| 6 | edit | human modify | editable table |
| 6 | → simulation_code_assumptions_4 | model modify | `applyAssumptions` |
| 7 | drag region | human select | `RegionOverlay` |
| 7 | sketch | human specify | `SketchCanvas` |
| 7 | → replacement_svg | model translate | `sketchToSvg` (model reads PNG) |
| 7 | → simulation_code_redrawn_4 | model modify | `integrateSvg` |
| 7 | → redrawn_simulation | tool_1 execute | `SimulationFrame` |
| 8 | drag region | human select | `RegionOverlay` |
| 8 | → subgraph | model match | `matchSubgraph`; highlighted in UI graph |

## Open choices and defaults taken

- Layout: two modes — "Author" (wizard for process 1/2) and "Workspace" (simulation centre, UI graph left, tabbed tools right for processes 4–8, version history).
- Process 3 runs automatically right after simulation_code_1 is produced, with each step visible.
- Edit processes 4–7 operate on the *current* code version (initially simulation_code_3) and append a new version; earlier versions kept and restorable.
- Images: none in the design.
