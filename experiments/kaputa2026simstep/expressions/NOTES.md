# NOTES — decisions the design did not determine

The design (`design.json`) gives eight process expressions and nothing else: no goal, no system or
process descriptions, no representation descriptions, no references, no images. Every decision about
*what the representations contain*, *how the processes are triggered*, and *what the UI looks like*
was therefore mine. They are listed below.

## Overall interpretation

- **Domain.** From the identifiers (learning_content, concept_graph, scenarios, learning_goals,
  experiment_factors, procedure, ui_graph, simulation_code, tests) I read the system as an authoring
  tool with which a teacher turns learning content into an interactive science simulation. The
  sample content (buoyancy) and the wording of all prompts follow from that reading.
- **How processes fit together.** Process 1 (+2) is an "Author" wizard. Process 3 runs automatically
  right after `simulation_code_1` exists (no trigger was given; the connection says it continues from
  process 1). Processes 4–8 are tools in a "Simulation workspace" mode.
- **Process 2 placement.** `concept_graph_1 → concept_graph_2` has no downstream connection. I made
  the concept graph editable in place before scenario generation, so scenarios (and everything after)
  are built from the edited graph when it exists. "Revert to generated graph" restores v1.
- **Edits after code_3.** Processes 4–7 each start from `simulation_code_3` and produce a different
  `*_4`. I treat these as edits to the *current* code version: each produces a new version
  (`simulation_code_guided_N`, `_chat_N`, `_assumptions_N`, `_redrawn_N`, N = position in the history),
  which becomes current; all versions are kept and can be switched to in a version bar. So edits chain
  rather than all branching from code_3.
- **Representations that drop out of a state.** I followed the rule that each prompt is built only
  from the preceding state, with two pragmatic exceptions, documented here:
  - Process 4: after `[human evaluate]` the state holds only `ui_test_feedback + simulation_code_3`.
    A bare categorical verdict is not enough to diagnose, so the verdict is passed together with the
    test it judges (title, expected outcome, run log) — treating the evaluation as attached to its
    subject.
  - Process 5: `[model modify]` sees only `ui_graph_2 + simulation_code_3`. To make the approved change
    reach the code through the graph, `tool_1 modify` writes a `change_note` onto changed nodes; the
    model regenerates code from the graph with those notes. If the human approved no structural graph
    edit, the note is attached to the nodes tagged in the selected region.
  - Process 1: the UI-graph prompt uses `learning_goal_graph + learning_goal + procedure` (not the
    experiment factors, which are not in the preceding state); the code prompt uses only
    `ui_graph + learning_goal`.

## Data formats (all defined in `shared/types.ts`)

- Graphs (`concept_graph`, `scenario_graph`, `learning_goal_graph`, `ui_graph`, `subgraph`):
  `{nodes:[{id,label,description,kind}], edges:[{source,target,label}]}`. Kind vocabularies:
  concept graph `concept|quantity|law|phenomenon`; scenario graph `entity|variable|process|concept`;
  UI graph `container|control|display|visual|logic` (validated).
- `learning_goal_graph`: the model returns node ids; code validates them and builds the induced
  sub-graph deterministically (so the "select" really is a selection).
- `experiment_factors`: independent / dependent / controlled variables with unit, min, max, default,
  node_id, description.
- `scenarios`, `learning_goals`: lists of 4 strings. `procedure`: numbered plain text.
- `simulation_code`: one self-contained HTML document; every element realizing a UI-graph node must
  carry `data-ui-node="<id>"` (this is what lets region selection map onto the graph). No network
  resources (blocked in the headless runner).
- `test_cases`: `{id,title,purpose,steps:[{action: click|set_value|wait|read_text, selector, value}],expected}`.
- `test_results`: `{test_id, step_errors, console_errors, read_values, visible_text}`; one PNG screenshot per test.
- `repair_target`: one of `layout, visual_rendering, controls, simulation_logic, data_display, text_labels` (shared by processes 4 and 5).
- `ui_test_feedback`: `works | partially_works | broken`; "works" ends process 4 without a repair.
- `suggested_repair` / `suggested_change`: `{target, summary, changes[], rationale, ui_graph_changes?}`;
  the approved version keeps only the checked changes (and the graph edits if their box is checked).
- `assumptions`: `{node_id, items:[{name,value,rationale}]}`.
- Regions: `{x,y,w,h, elements[]}` in iframe pixels; `elements` are the DOM elements inside the
  rectangle (tag, id, data-ui-node, text, rect), gathered by a script injected into the iframe.
- `sketch`: PNG data URL; `replacement_svg`: SVG markup (rejected if it contains `<script>`).

## Actors and tools

- **Model provider:** local Claude Code CLI, `claude -p --output-format json`, `CLAUDECODE` unset,
  prompt via stdin, operation instructions via `--append-system-prompt`, run in a fresh temp dir with
  file/shell tools disallowed. One function: `callModel()` (`server/model.ts`). Model is the CLI default
  unless `CLAUDE_MODEL` is set. All model roles use the same model; they differ by prompt.
- **Images to the model:** written to the temp dir; the model is allowed only the `Read` tool and is told
  the paths (sketch in process 7, test screenshots in process 3).
- **Validation:** zod schemas for JSON outputs, completeness checks for HTML, SVG checks, id checks
  against the graph; one automatic retry with the validation error appended.
- **tool_2 = headless browser** (Playwright Chromium, 900×640): `javascript_errors` come from loading
  the page and generically poking every input and button; `runTests` executes the test steps and
  screenshots the result.
- **tool_1 = in-app live runtime:** a sandboxed iframe (`allow-scripts` only) with an injected runner
  that executes a UI test step by step with a visible outline on each target element (process 4), and
  reports elements inside a region (processes 5, 7, 8). `tool_1 modify` in process 5 is the
  deterministic graph-diff function `applyGraphChanges`.

## Prompts

One prompt per operation in `server/ops.ts`; sizes I chose: concept graph 6–14 nodes; 4 scenarios;
scenario graph 8–16 nodes; 4 learning goals ("Learners will be able to…"); procedure 5–9 steps;
UI graph 6–14 nodes; 3–6 test cases; 1–5 suggested changes; 3–8 assumptions. Code outputs are
requested as a fenced ```html block rather than inside JSON, to avoid escaping problems.

## Interaction details

- Human `select` of scenarios and learning goals: clickable cards; picking one immediately triggers the
  following model steps. Picking again discards everything downstream.
- After the learning goal is picked, the rest of process 1 and all of process 3 run without further
  input; a step tracker shows which step runs; intermediate artifacts (factors table, procedure, UI
  graph, JS errors, test cards with screenshots, assessment) appear as they arrive.
- Process 4: radio list of tests → "Run in simulation" → three verdict buttons → repair target tag →
  checklist of suggested changes → "Apply N approved change(s)" / "Suggest again".
- Process 5/7/8: drag a rectangle over the simulation (an overlay over the iframe); colour per tool.
  Process 7 opens a white drawing canvas exactly over the region (5 pen colours, clear/cancel); after
  "Use sketch" the SVG translation and code integration run automatically (no human step between them in
  the design), with sketch and SVG previews shown. Process 8 highlights the matched nodes in the UI graph
  and dims the rest.
- Process 6: clicking a UI-graph node switches to the Assumptions tab and extracts assumptions
  automatically; edited cells are highlighted; "Undo edits", "+ Add", "Apply to simulation".
- Errors: every model step shows a spinner and on failure an error box with "Retry".

## Layout and styling

- Author mode: single column of numbered cards. Workspace: three columns — UI graph (left), simulation
  at a fixed 900×640 with a code-version bar and HTML download (centre), tabbed tool panel (right).
- Graph rendering: dagre layered layout, SVG rectangles coloured by `kind`, hover tooltip with
  description. Plain CSS, slate/blue palette, system font.

## Libraries and stack

Vite + React 19 + TypeScript; Express 5 server run with `tsx`; `zod`; `@dagrejs/dagre`; `playwright`;
`concurrently`. State lives in React context persisted to `localStorage` (single project, screenshots
dropped if quota is exceeded). No database. Ports: server 8931, web 5317.

## Things I added that are not steps in the design

Nothing that changes the process structure. Supporting affordances only: "Regenerate" buttons,
"Re-run verification", "Revert to generated graph", version switching, HTML download, a sample text.

## Verification performed

- `npm run build` (tsc + vite) and `npm test` (4 tests: graph diff, output parsing, headless error
  capture, headless test run) pass.
- `scripts/e2e.ts` ran every model and tool step of processes 1–8 against the real Claude CLI with a
  buoyancy text. All 26 endpoints succeeded and no output failed validation. The slowest steps are
  full-code generation and modification (80–215 s each).
- `scripts/ui-walkthrough.mjs` drove the browser UI with those artifacts. It covered process 4 (live
  test run in the iframe, with the step log), process 8 (region → matched nodes highlighted) and
  process 7 (region → sketch canvas → SVG → `simulation_code_redrawn_4` rendered). No page errors.
  The UI for processes 1, 2, 5 and 6 was type-checked and rendered, but this walk-through did not
  click through it. Their back-end steps were exercised by `e2e.ts`.

## Did the design remind me of a published system?

Not of one specific system that I can name with confidence. The combination — LLM-generated
educational simulations from learning content via intermediate concept/scenario/learning-goal graphs,
a UI graph as the intermediate representation for code, automatic headless test-and-repair, and
teacher refinement through region chat, assumption editing and sketch-based redraw — reads like a
recent HCI research prototype for teacher authoring of interactive science simulations, but I do not
recall its name or its interface, and I did not look it up.

Choices that came from general prior knowledge rather than from the design:
- The look of the generated simulations (sliders for independent variables, live readouts, an animated
  canvas) follows the familiar PhET-style interactive simulation convention; the prompts ask for that.
- Using a headless browser (Playwright) with console/pageerror capture, then feeding errors back to the
  model, follows common LLM code-repair loops.
- Tagging generated DOM elements with node ids (`data-ui-node`) to link screen regions to the graph is
  my own mechanism, chosen so process 8 (and region context for 5 and 7) can work; it is not from a
  known system.
- The "experiment factors" split into independent/dependent/controlled variables is standard
  science-education vocabulary, not stated in the design.
