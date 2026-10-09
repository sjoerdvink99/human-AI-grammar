# NOTES — decisions the design did not determine

The design (`design.json`) fixes the processes, representations, actors and the plain-language
descriptions. Everything below was my choice.

## Stack and libraries
- **Frontend:** Vite + React 18 + TypeScript, plain CSS (`src/styles.css`). No state library; one `Project` object in `App.tsx` passed through a React context.
- **Graph view/editing:** `@xyflow/react` (React Flow) with a custom node component and my own layered layout (longest path from sources, `src/lib/graph.ts`). No dagre/elk.
- **Backend:** Express on Node, TypeScript through `tsx`. Stateless; one route `POST /api/op/<operation>` per design operation. Default port 8642, because other runs on this machine were already using 8787.
- **Validation:** `zod` (v4) schemas for every structured model output. The JSON Schema sent to the CLI's `--json-schema` is generated from the same zod schemas.
- **tool_2 (headless browser):** Playwright Chromium.
- **tool_1 (browser runtime):** an `<iframe srcdoc>` with `sandbox="allow-scripts allow-same-origin"`. Same-origin lets the app replay tests and read the DOM under a drawn region. The cost is that generated code is not isolated from the app. That is acceptable for a local authoring tool, but I'm noting it.
- **Persistence:** `localStorage` (test screenshots are dropped to stay within quota), plus Export/Import as JSON. No database, no accounts.
- **Tests:** vitest (`tests/core.test.ts`). It covers graph operations, graph normalization, layout, and the Playwright tool running real HTML.

## Model provider
- `server/model.ts` → `callModel({op, system, prompt, schema?, images?})` is the only provider boundary. It spawns `claude -p --output-format json --no-session-persistence --system-prompt … [--json-schema …]` with `CLAUDECODE` removed from the environment. The prompt goes in on stdin.
- **Structured outputs** use `--json-schema` and read `structured_output`, with a fallback that parses JSON out of the text. A failed zod validation is retried once, with the error appended to the prompt.
- **Code outputs** are free text. The prompt asks for one fenced ```html block, which is then extracted and checked as a complete HTML document; this is retried once. I avoided JSON here because escaping whole HTML documents inside JSON is fragile.
- **Image inputs** (test screenshots, annotated region screenshots, sketches) are written to `.tmp/`. The CLI is started with `--tools Read --allowedTools Read --add-dir .tmp`, and the prompt lists the file paths for it to read. Without images, all tools are disabled (`--tools ""`).
- The model is the CLI default unless `SYSTEMX_MODEL` is set. There is one shared system prompt ("language model inside an authoring tool for teachers…"). The design has only one model actor, so there are no separate model roles.

## Data formats
- **Graph** = `{nodes:[{id,label,type,description}], edges:[{id,source,target,label}]}` for every graph level. Node type vocabularies differ by level:
  - concept: concept/quantity/law/phenomenon/object
  - scenario: object/property/quantity/process/environment
  - UI: control/display/visual/logic/container
- **Graph normalization in code:** duplicate ids are dropped, dangling or self links are removed, and missing edge ids are filled in.
- **learning_goal_graph:** the model returns only node ids. Code builds the subgraph from the scenario graph, so the result is always a true subset.
- **experiment_factors:** `{independent, dependent, controlled}`, each a list of `{name, description, range, unit}`.
- **procedure:** numbered steps joined as text.
- **simulation_code:** one self-contained HTML document. The prompts carry a "contract":
  - no external resources
  - fits a 900×640 viewport
  - every element that realizes a UI-graph node gets `data-ui-node="<node id>"` and `id="<node id>"`
  - no alert/prompt

  The contract is what lets tests, region-to-element mapping (P5/P7/P8) and the assumptions process (P6) link the code back to the UI graph.
- **Code versions:** every version is kept as `{id, label, html, note}`. Labels follow the design (`simulation_code_2`, `simulation_code_chat_5`, …); the number is the position in the history, not the design's fixed `_4`. A version dropdown shows the history, and selecting an older version makes it current (revert).
- **Graph versions:** every save is kept (`concept_graph_1`, `_2`, …). Older versions can be viewed read-only; only the latest version is editable.
- **test_cases:** `{id,title,purpose,steps[{action: click|set_value|press|wait|read, selector, value}], expected, needs_human_check}`.
- **test_results:** `{test_id, completed, observations[], errors[]}`. Observations are snapshots of every `[data-ui-node]` element's value/text before and after the steps, plus explicit `read` steps.
- **test_screenshots:** one JPEG per test, taken after its last step.
- **test_assessment:** `{meets_goal, summary, problems[]}`.
- **ui_test_feedback** (categorical): `as_expected | no_response | wrong_behavior | wrong_visual | layout_problem`. There is no free text, because the design makes this categorical.
- **repair_target** (categorical): `concept_graph | scenario_graph | learning_goal_graph | ui_graph | code`.
- **suggested_repair:** `{level, summary, details}`.
- **suggested_change:** `{level, summary, operations[]}`. Each operation is one of add_node/remove_node/update_node/add_edge/remove_edge with flat fields. It is shown as an editable widget: each operation's fields can be edited, and operations can be dropped.
- **Regions (chat/redraw/subgraph):** a freehand closed stroke in simulation coordinates, with `{points, bbox, elements}`, where `elements` are the live DOM elements sampled on a grid inside the bbox. The model also receives a Playwright screenshot of a fresh load of the simulation with the stroke drawn in red. Interaction state from the live iframe is not reproduced in that screenshot.
- **assumptions:** `{node_id, node_label, items[{id,text}]}`. The teacher edits them as one assumption per line in a textarea.
- **replacement_svg:** a string checked for one `<svg>…</svg>` with no `<script>` and no external hrefs.

## Process interpretation and triggers
- **P1 automatic steps:**
  - Model steps that follow each other run automatically: concept graph → scenarios, scenario graph → goals, and goal → learning-goal graph → factors → procedure → UI graph → code.
  - Human selections are a radio list plus a confirm button.
  - Scenario/goal suggestions can be regenerated. Later steps can be re-run from the current (edited) graph with "Regenerate design" and "Regenerate code from UI Graph". These re-run existing design steps; they add no new step.
- **P1 prompt inputs:** each model prompt uses only the representations in the state before it. For example, `generateUiGraph` sees the learning-goal graph, goal and procedure, but not the factors; `translateSimulationCode` sees only the UI graph and goal. To make that work, the UI-graph prompt asks for implementable node descriptions (ranges, formulas, behaviour).
- **P2:** the same `GraphEditor` serves all four graph levels:
  - click a node or link to rename it, retype it or edit its description, or delete it
  - "+ Node" adds a node
  - dragging handle to handle adds a link
  - "Save as vN+1" creates the new version; "Discard" reverts

  Downstream steps always use the latest version.
- **P3:**
  - Starts automatically right after `simulation_code_1`.
  - Error-fix loop runs at most 2 model fixes.
  - The assessment-driven correction runs once, and only when `meets_goal` is false. When no fix is needed, the code is carried forward unchanged instead of creating an identical version.
  - Can be re-run manually from the "Auto tests" tab.
- **P4:**
  - "Tests that require human verification" are the tests with `needs_human_check = true`; the other tests are listed under a collapsible section.
  - Playback reloads the iframe, then runs the steps visibly: an orange outline on the target element and about 0.9 s between steps.
  - The step log is the textual `ui_test_result`, next to the visual iframe.
  - Choosing "as expected" ends the flow. Any other choice runs model select → model generate.
  - Approve applies the repair to the code; Reject discards it.
- **P4 prompt inputs:** I treat the `ui_test_feedback` record as carrying a reference to the test it judges, because a bare category means nothing to the model without it. That reference is the only thing added beyond the design's state.
- **P5 repair level:**
  - The model's `repair_target` is shown to the teacher in the chat.
  - The suggested change is always expressed as operations on the UI graph, because the design's next state is `ui_graph_2`. When the target is a higher graph level, the summary explains that.
  - Applying the operations is deterministic code (`applyGraphOps`, tool_1 modify), and its warnings go to the log.
  - Code revision then sees only `ui_graph_2` and the code, as in the design.
- **P6:** clicking a node in the UI Graph view selects it and switches the tool panel to "Assumptions". Extraction runs on button press. "Apply" is enabled once the text differs from the extracted text.
- **P7:**
  - "Circle graphic to replace" arms the overlay.
  - The sketch pad is a 320×240 canvas with 8 colours, a brush size control and Clear.
  - "Turn sketch into graphic" runs sketch → SVG → code automatically. The SVG preview is shown, and the iframe reloads with the new code (tool_1 execute).
- **P8:**
  - The "Subgraph selector" arms the overlay. When the stroke ends, `matchSubgraph` runs automatically.
  - The graph view switches to the UI Graph, where matched nodes and links get a red outline and everything else is dimmed. A list and the explanation appear in the panel; "Clear highlight" resets them.
  - Node ids the model returns are filtered to existing ids. Edges are the matched edge ids that connect matched nodes, plus every edge between matched nodes.
- **Shared starting point:** processes 4–8 all start from the *current* code version, so their outputs chain one after another (each becomes the next current version).

## Layout and styling
- **Three columns:**
  - left (340 px): the process-1 pipeline as numbered step cards
  - centre: graph tabs (Concept / Scenario / Learning Goal / UI), a version picker, the editor with an inspector sidebar, and the last 6 log lines
  - right: the code-version picker, the simulation (scaled to the column width, fixed 900×640 internal size), and tool tabs (Auto tests, Guided test, Chat, Assumptions, Redraw, Inspect, Code)
- Dark header with a global busy indicator (spinner plus the current step label). Errors appear in a dismissable red banner.
- Only one model/tool operation runs at a time. Buttons are disabled while busy.
- Node colours encode node type. The circled-region stroke colour depends on the mode.
- The Code tab shows the source with a small hand-written syntax highlighter and offers a download.

## Model prompts (summary; full text in `server/ops.ts`)
- One prompt per design operation, 26 in total.
- Every code-producing prompt includes the simulation contract and asks for the complete updated document.
- Size limits I set: 6–16 concept nodes, 6–18 scenario nodes, 6–16 UI nodes, 4 scenarios, 4 goals, 4–8 procedure steps, 4–7 tests, 4–10 assumptions.
- Region prompts include the bbox, the sampled DOM elements, and the annotated screenshot.
- The example learning content ("Newton's second law…") is my own.

## Verification
- `npm run typecheck`, `npm run build` and `npm test` (4 tests) all pass.
- I walked through every process once by driving the built app with Playwright against the real `claude` CLI, using the example content (Newton's second law). Every transformation was reached:
  - **P1:** concept graph → 4 scenarios → scenario graph → goals → goal graph → factors → procedure → UI graph → `simulation_code_1`. Code generation took about 3.5 minutes.
  - **P3:** started automatically. No JavaScript errors, so there was no fix round. Tests were generated and run with screenshots, the assessment said "meets goal", so no correction was made.
  - **P2:** renamed a concept node and added a node → `concept_graph_2`.
  - **P8:** circled the data table → 4 nodes and 3 links highlighted in the UI Graph.
  - **P6:** selected a UI node, got 10 assumptions, added one line → `simulation_code_assumptions`.
  - **P5:** circled the readouts and typed an issue → repair level "ui_graph" plus editable operations; accepting gave `ui_graph_2` → `simulation_code_chat`.
  - **P7:** circled, sketched, SVG generated → `simulation_code_redrawn`, and the iframe reloaded.
  - **P4:** played a human-check test, reported "Looks wrong" → repair level + suggested repair → approved → `simulation_code_guided`.
- Not exercised in that run:
  - the P3 JavaScript-error repair branch and the assessment-correction branch, because the generated code had no errors and met the goal (the error collection itself is covered by the unit test)
  - the P4 "Reject" path
- **Environment issue:** other experiment runs on the same machine killed my server process twice. The cause was port and process-name collisions, so I changed the default port to 8642. Each failed step was re-run after a restart.
- **Graph layout:** layers wider than 4 nodes wrap onto staggered rows, and the view auto-fits once nodes are measured. This keeps graphs readable in the centre column.

## Did the design remind me of a published system?
Yes. The chain Concept Graph → Scenario Graph → Learning Goal Graph → UI (interaction) Graph → code for teacher-authored educational simulations, together with "inverse correction", a "Subgraph Selector", sketch-based redraw and code-assumption editing, strongly resembles **SimStep** (a 2025 research system on a "chain of abstractions" for specifying and debugging AI-generated interactive educational simulations). I only remember it at the level of its abstract and main idea; I did not look it up.

**Choices that came from that knowledge rather than the design:** almost none. The graph names, the inverse-correction idea, the Subgraph Selector, assumption editing and redrawing are all named in the design itself. I do not remember SimStep's actual UI layout, prompts, test format or graph schemas. Everything listed above (three-column layout, React Flow editor, `data-ui-node` contract, categorical feedback values, graph-operation format, Playwright test-step DSL) is my own invention. The only possible influence is a general expectation that the graphs should be shown as editable node-link diagrams side by side with the running simulation. The design already implies that through the `graph` medium and the `human modify` step.
