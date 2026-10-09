# NOTES — decisions the design did not determine

The design (`design.json`) fixes only the *structure*: 8 processes of typed representations
(`r1`…`r40`, role + medium) and transformations (actor + operation, generative or not), plus how
processes share identifiers. It has **no goal, no descriptions, no representation contents, no
references and no images**. Everything below was decided by me.

## 1. Domain and the meaning of every representation

| Decision | Choice |
|---|---|
| What the system is for | Turning a natural-language request into a **data-driven SVG visualization program** (plain JS), then testing and refining it. Chosen because the design goes language → several graphs → `formal` code → two `execute` tools producing `visual` output and per-test records, then edits by region selection, sketching and component parameters on that visual. |
| r1 | The user's request for a visualization. |
| r2 | "Intent graph": goal / data / encoding / interaction / style / audience nodes with one goal node. |
| r3* | 4 alternative design concepts as short prose ("Title: …"). |
| r4 | The chosen concept text, used verbatim as the instruction. |
| r5 | "Design graph": 8–16 requirement nodes (data, transform, mark, encoding, scale, axis, legend, …) with dependency edges. |
| r6* | 3–4 alternative build instructions for the first version, ordered smallest → most complete. |
| r7 | The chosen build instruction; carried through process 1 and 3 as in the design. |
| r8 | Subgraph of r5: the model returns node ids, code builds the subgraph (validated subset). |
| r9 | Data spec: typed fields + 6–15 sample rows (validated: every row has every field). |
| r10 | Numbered implementation plan (prose). |
| r11 | Component graph of the program (data, scale, axis, mark, legend, label, layout, interaction, style). |
| r12 and later code versions | One JS program with a fixed contract: `const SAMPLE_DATA = [...]` and `function render(svg, data)` on a 640×400 SVG, no imports, `<g data-component="<id>">` groups. Enforced by `validateCode` (syntax check, required symbols, no imports). |
| r13* | Runtime/syntax errors (and "rendered nothing") from running on SAMPLE_DATA. |
| r14* | 5 test cases: name, description, expectation, input data (model returns JSON as a string, parsed and validated). |
| r15* / r16* | Per-test execution record (status, errors, console logs, element counts by tag) and SVG snapshot. |
| r17 | Bullet-list critique of the test results. |
| r18 / r20 / r38 | Live rendering in a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin). |
| r19 | The clicked test case. |
| r21 | Verdict from a fixed set: correct / something-missing / something-wrong / unreadable. |
| r22 / r22_2 | Issue category from a fixed set: layout, scales-axes, marks, labels-text, color, data-handling, interaction, other (enum in the JSON schema + validator). |
| r23 / r24 | Diagnosis + 3 fix options {title, instruction}; r24 is the clicked option. |
| r26 / r34 / r39 | Rectangle drawn on the rendering, in SVG units. |
| r27 | Free-text change request for the region. |
| r28 / r29 | 2–3 graph-edit options {summary, edit: addNodes/updateNodes/removeNodeIds/addEdges/removeEdges}; validated against r11 (no unknown ids). |
| r31 | One component (node) of r11, picked from a menu or by clicking the node. |
| r32 | 3–10 tunable parameters of that component {name, kind number/color/string/boolean, value, description}. |
| r35 | Freehand strokes inside the selected region. |
| r36 | A code fragment + one-sentence interpretation of the sketch. |
| r40 | Ids of r11 nodes, highlighted in yellow in the graph view. |
| r25_4, r30_4, r33_4, r37_4 | Treated as new versions of the program (the design gives them new ids at version 4); they are appended to one code-version list and become the current program. |

## 2. Flow, triggers and interpretations of the expressions

* **Two modes**: "Design" (processes 1 and 2, a vertical sequence of step cards) and "Workspace" (processes 3–8).
* **Process 1** pauses only at its two human selects; all model steps run automatically. I added a pause after r2 with a "Generate design concepts" button so that **process 2** (edit r2) has a place to happen; continuing uses the latest r2 version. Concepts and build options can be regenerated (the `~` steps).
* **Process 3** starts automatically when process 1 produces r12_1 (the connection P1→P3), and can be re-run with a button. The repair step (`model modify` → r12_2) always runs, even with no errors (it is then told to make only robustness fixes), because the design always has it.
* `tool_1` = renderer and graph-edit applier; `tool_2` = test runner. Both run in the browser (hidden sandboxed iframes) because they execute untrusted generated code and need a DOM; the server never executes generated code (it only parses it for a syntax check).
* **Process 4**: the design's state before `[model select]` holds only r21 + r12_3. A bare verdict without the test it judges is not actionable, so the prompt also includes the selected test case (treated as what the evaluation is attached to). This is my interpretation.
* **Process 5**: choosing a graph-edit option immediately applies it (tool_1 modify → r11_2, kept as a new graph version, older versions selectable) and then updates the code from the graph. The code prompt sees only the updated graph and the code, as in the design.
* **Process 6**: selecting a component triggers extraction; edited values are highlighted; "Apply" sends only changed parameters (with old → new values).
* **Process 7**: the user first drags a region, then draws inside it (strokes are clipped to the region). The sketch is sent to the model as **stroke coordinates** (polylines in SVG units), not as a raster image, because the CLI runs with no tools. The merged program is re-rendered (r38) in the main view.
* **Process 8**: drawing a region triggers the match immediately; the model must infer positions from the code's layout logic (the design gives it no access to the rendering in that state).
* **Later processes act on the latest code version**, not strictly on r12_3, so edits compound. The main view always renders the current version, which means renders also happen after processes 4–6 although the design shows `tool_1 execute` only in processes 3 and 7.
* Earlier code versions remain viewable in the Code tab (with a +/− line count vs the previous version); picking an older version makes it the base for the next edit (a simple revert).

## 3. Model calls

* One function, `callModel()` in `server/llm.ts`, spawns `claude -p --output-format json --no-session-persistence --tools "" --system-prompt … --json-schema …` with `CLAUDECODE` removed from the environment; the prompt goes on stdin; the `structured_output` field is used (fallback: first JSON object in `result`). Model = CLI default unless `CLAUDE_MODEL` is set. 4-minute timeout.
* One prompt per model operation (24 ops in `server/ops.ts`), each built only from the representations in the preceding state (with the process 4 exception above). A shared short system prompt; a shared "program contract" paragraph is appended to every code-producing prompt.
* Every output is validated; on failure the server retries once with the validation error appended to the prompt, then reports the error in the status bar.
* `model select` / `model match` / `model extract` steps return ids or fields that are checked against the input (no invented node ids).
* SVG snapshots are truncated to 2,500 characters per test in the evaluation prompt; test data to 300–800 characters in other prompts.

## 4. Stack, layout, styling

* Vite 5 + React 18 + TypeScript; zustand (with `persist` → localStorage) for state; Express 4 run with `tsx`; highlight.js (JavaScript only, GitHub theme) for code; vitest for unit tests; Playwright (dev) for the end-to-end walkthrough script.
* No database: a session lives in localStorage and survives reloads; an interrupted model call is not resumed.
* Layout: sticky top bar with mode tabs and "new session"; a sticky status bar showing the running step (spinner), the last step, or an error. Workspace: left = rendering (640×400) with a tool bar (Interact / Edit region / Sketch / Locate in graph) and the active tool's panel below; right = tabs "Component graph" (+ parameters panel) and "Code"; bottom = process 3 status/critique and the test gallery with the review panel.
* Graph view: custom SVG, left-to-right layered layout (longest path from sources), boxes coloured by node `kind`, descriptions as tooltips. The intent-graph editor is a table (label/kind/description per node, link list, add/remove).
* Visual style: light, neutral grey panels, one blue accent, monospace badges showing the design identifier (`r18`, `r11_2`, …) next to each representation so the mapping stays traceable in the UI.
* No React StrictMode, because double-invoked effects would duplicate model calls that human selections trigger.

## 5. Did the design remind me of a published system?

Not of one specific system that I could identify with confidence. The structure — natural-language
request → intermediate graphs → code → execute → model self-evaluation → repair, followed by
selection-based edits of the rendered output — is broadly reminiscent of LLM visualization
generators such as **LIDA** (Dibia, 2023: goal generation, visualization code generation,
self-evaluation and repair) and of later work on "intent → specification → code" pipelines for
charts and interactive graphics, and the region/sketch editing of rendered output is reminiscent
of sketch-based or direct-manipulation editing of generated code in general. The repeated
`graph` artifacts and the region-to-graph-node matching do not match LIDA, so the design may well
describe a different system (it could equally be, for example, a game, simulation or UI generator).

Choices that came from that background knowledge rather than from the design:

* Picking **data visualization** as the domain (LIDA-like) instead of, e.g., UI or game generation.
* Making r9 a **data specification with sample rows** and requiring the program to carry `SAMPLE_DATA`.
* Treating `tool_2 execute` as **running the program on generated test inputs** and feeding errors and
  rendered snapshots to the evaluating model, i.e. a generate–execute–evaluate–repair loop, and
  making the critique a list of concrete problems with suggested fixes.
* Using a **fixed issue-category set** with chart-specific values (scales-axes, marks, labels-text, …).

Everything else (graph kinds, region/sketch interactions, parameter extraction, UI layout, prompts)
was derived from the expressions themselves and general engineering judgement.

## Appendix — verification and known limitations

* `npm run typecheck`, `npm test` (7 unit tests: graph-edit tool, validators, sandbox escaping, op registry) and `npm run build` pass.
* `scripts/walkthrough.mjs` drove all 8 processes in headless Chromium with real Claude CLI calls
  (request about monthly rainfall in five cities): every one of the 24 model operations validated on
  the first attempt; the run finished with 7 code versions (r12_1, r12_2, r12_3, r25_4, r30_4, r33_4, r37_4)
  and component graphs r11_1 → r11_2. Total ≈ 7.5 minutes.
* Limitation seen in that run: the model sometimes gives the program its own internal viewBox
  (e.g. 800×460) scaled into the 640×400 canvas. Regions are always sent in 640×400 canvas units, and the
  models mapped them correctly, but I added the fixed canvas size to the plan prompt to discourage this.
* Model latency is 4–45 s per step; process 1 + 3 take about 4 minutes before the workspace opens.
