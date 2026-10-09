# PLAN — "System X" implementation

The design (`design.json`) gives 8 processes but no goal, no descriptions, no representation
descriptions, no references and no images. Everything below that names *content* is therefore
inferred, and taken as the default without waiting for confirmation (per the experiment brief).

## Inferred domain

The shape of the design — a natural-language request translated through several graphs into
`formal` code, executed by two tools into `visual` output and test results, then edited by selecting
regions on the visual, sketching, picking graph components and tuning parameters — fits a
**generator of data-driven SVG visualization programs**:

* the user describes the visualization they want (r1),
* models turn it into an intent graph, design concepts, a design graph, scoped build instructions,
  a data spec, a plan and finally a **component graph** (r11) and **JavaScript code** (r12),
* `tool_2` = a sandboxed **test runner** (runs the code on test inputs, collects errors, outputs and
  snapshots); `tool_1` = the sandboxed **renderer** (draws the main view, applies graph edits),
* the human then refines the program from the rendered view (processes 4–8).

Generated program contract: plain JavaScript (no libraries) that defines
`const SAMPLE_DATA = [...]` and `function render(svg, data)` drawing into a 640×400 `<svg>`.

## Stack (repo was empty)

* Frontend: Vite + React 18 + TypeScript, zustand for state, highlight.js for code highlighting.
* Backend: Express (TypeScript via `tsx`), one function `callModel()` in `server/llm.ts` that shells
  out to `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed.
* Validation: hand-written validators per operation in `server/validate.ts`, one automatic retry.
* Persistence: session saved to `localStorage` (no database).
* Tests: vitest for deterministic tools and validators.

## Representations

| id | type | contents (inferred) | file |
|---|---|---|---|
| r1 | instruction language | user's request for a visualization | `src/store.ts` (`request`) |
| r2 | artifact graph (versions r2_1, r2_2) | **intent graph**: goal / data / encoding / interaction / style nodes | `src/shared/types.ts` `Graph`; store `intentGraph` |
| r3* | artifact language* | 3–4 alternative **design concepts** (short prose) | store `concepts` |
| r4 | instruction language | the chosen concept, used as instruction | store `concept` |
| r5 | artifact graph | **design graph** (detailed requirements) | store `designGraph` |
| r6* | instruction language* | 3–4 candidate **build instructions** (scope of first version) | store `buildOptions` |
| r7 | instruction language | chosen build instruction | store `buildInstruction` |
| r8 | artifact graph | subgraph of r5 relevant to r7 (model picks node ids) | store `scopeGraph` |
| r9 | artifact record | **data spec**: fields + sample rows | `DataSpec`; store `dataSpec` |
| r10 | artifact language | implementation plan | store `plan` |
| r11 | artifact graph (r11_1, r11_2) | **component graph** of the program (components + data flow) | store `componentGraph` (+history) |
| r12 | artifact formal (r12_1..3, r25_4, r30_4, r33_4, r37_4) | JavaScript program | store `codeVersions` |
| r13* | evaluation language* | runtime/syntax error messages from tool_2 | store `runErrors` |
| r14* | artifact record* | **test cases** {name, description, expectation, data} | `TestCase`; store `testCases` |
| r15* | artifact record* | per-test execution result {status, errors, element counts} | `TestResult` |
| r16* | artifact visual* | per-test SVG snapshot | `TestResult.svg` |
| r17 | evaluation language | model critique of test results | store `critique` |
| r18 | artifact visual | main rendering of current code (live sandbox iframe) | `VisualView.tsx` |
| r19 | selection record | the selected test case | P4 panel state |
| r20 | artifact visual | rendering of the selected test case | P4 panel |
| r21 | evaluation categorical | human verdict: correct / missing / wrong / unreadable | P4 panel |
| r22 | selection categorical | issue category from a fixed set (layout, scales-axes, marks, labels-text, color, data-handling, interaction, other) | `ISSUE_CATEGORIES` |
| r23 | artifact record | {diagnosis, options[{title, instruction}]} fix proposals | P4 panel |
| r24 | instruction record | the chosen fix option | P4 panel |
| r26 / r34 / r39 | selection spatial | rectangle on the rendered view (SVG coordinates) | `VisualView.tsx` |
| r27 | instruction language | user's text request for the region | P5 panel |
| r28 | artifact record | graph-edit options {summary, edit{add/remove/update nodes & edges}} | P5 panel |
| r29 | instruction record | the chosen graph edit | P5 panel |
| r31 | selection categorical | one component (node) of r11 | P6 panel |
| r32 | artifact record (r32_1, r32_2) | parameters of that component {name, value, kind, description} | P6 panel |
| r35 | instruction visual | freehand sketch drawn over the region | P7 sketch canvas |
| r36 | artifact formal | code fragment translated from the sketch | P7 panel |
| r38 | artifact visual | rendering after the sketch edit | `VisualView.tsx` |
| r40 | selection graph | nodes of r11 matched to a region (highlighted) | `GraphView` highlight |

## Transformations (process order)

| process | step | actor / op | implementation |
|---|---|---|---|
| 1 | r1→r2 | model translate~ | op `intentGraph` (`server/ops.ts`) |
| 1 | r2→r3* | model generate~ | op `concepts` |
| 1 | →r4 | human select | concept cards (`DesignFlow.tsx`) |
| 1 | r2+r4→r5 | model translate~ | op `designGraph` |
| 1 | r5→r6* | model generate~ | op `buildOptions` |
| 1 | →r7 | human select | build-option cards |
| 1 | r5+r7→r8 | model select | op `selectScope` (returns node ids; subgraph built in code) |
| 1 | →r9 | model extract | op `dataSpec` |
| 1 | →r10 | model generate~ | op `plan` |
| 1 | →r11 | model generate~ | op `componentGraph` |
| 1 | →r12_1 | model translate~ | op `code` |
| 2 | r2_1→r2_2 | human modify | `GraphEditor.tsx` (edit intent graph before continuing) |
| 3 | →r13* | tool_2 execute | `runTests()` in `src/tools/sandbox.ts` (sample data) |
| 3 | →r12_2 | model modify~ | op `repair` |
| 3 | →r14* | model generate~ | op `testCases` |
| 3 | →r15*+r16* | tool_2 execute | `runTests()` per test case |
| 3 | →r17 | model evaluate~ | op `evaluateTests` |
| 3 | →r12_3 | model modify~ | op `revise` |
| 3 | →r18 | tool_1 execute | `VisualView` live sandbox |
| 4 | →r19 | human select | test gallery (`TestsPanel.tsx`) |
| 4 | →r20 | tool_1 execute | sandbox render of selected test |
| 4 | →r21 | human evaluate | verdict buttons |
| 4 | →r22 | model select | op `issueCategory` |
| 4 | →r23 | model generate~ | op `fixOptions` |
| 4 | →r24 | human select | option cards |
| 4 | →r25_4 | model modify~ | op `applyFix` |
| 5 | →r26 | human select | region drag ("Edit region" mode) |
| 5 | →r27 | human specify | text field |
| 5 | →r22_2 | model select | op `regionCategory` |
| 5 | →r28 | model generate~ | op `graphEditOptions` |
| 5 | →r29 | human select | option cards |
| 5 | →r11_2 | tool_1 modify | `applyGraphEdit()` in `src/tools/graphEdit.ts` |
| 5 | →r30_4 | model modify~ | op `codeFromGraph` |
| 6 | →r31 | human select | component menu / click node in graph |
| 6 | →r32_1 | model extract | op `extractParams` |
| 6 | →r32_2 | human modify | parameter form |
| 6 | →r33_4 | model modify~ | op `applyParams` |
| 7 | →r34 | human select | region drag ("Sketch" mode) |
| 7 | →r35 | human specify | freehand canvas inside region |
| 7 | →r36 | model translate~ | op `sketchToCode` |
| 7 | →r37_4 | model modify~ | op `mergeFragment` |
| 7 | →r38 | tool_1 execute | sandbox re-render |
| 8 | →r39 | human select | region drag ("Locate" mode) |
| 8 | →r40 | model match | op `matchRegion`, nodes highlighted in graph |

## Images

None in the design.

## Open choices and defaults taken

* Provider: Claude Code CLI behind `callModel()` (required by the brief). Model = CLI default, override with `CLAUDE_MODEL`.
* Persistence: localStorage. Layout: two modes — "Design" (P1, P2) and "Workspace" (P3–P8).
* Process 3 starts automatically when process 1 produces r12_1 (connection P1→P3).
* Processes 4–8 act on the *latest* code version (each produces a new version that becomes current);
  the version list keeps all versions so they can be compared/reverted.
