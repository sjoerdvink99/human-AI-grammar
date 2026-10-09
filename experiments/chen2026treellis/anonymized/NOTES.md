# NOTES — decisions the design did not determine

The design gives only six expressions. It has no goal, no system or process descriptions, no
representation descriptions, no references and no images. Identifiers are opaque (`r1`…`r16`).
So nearly everything beyond the shape of the processes is my choice.

## Domain and meaning of the representations

- **Domain.** I read "language → model writes formal code → tool translates it into graph + visual + record"
  as a code-backed visual editor. I chose **2D vector drawings** described by a small custom language.
  Other readings would fit as well: chart specs, CAD/CSG, diagrams, or data pipelines.
- **r3 (artifact formal)**: a custom line-based "Shape DSL" (canvas, `param`, `group {}`, rect/circle/ellipse/line/
  polygon/polyline/path/text, attribute `key=value`, arithmetic over parameters, `{expr}` interpolation in strings).
  I chose a custom DSL over raw SVG so that parameters (r6) and stable line spans (for extract/splice) come for free.
- **r4 (artifact graph)**: the scene tree (groups and shapes), shown as an outline with icons and fill swatches.
- **r5 (artifact visual)**: the rendered SVG.
- **r6 (artifact record)**: the parameter table (name, type number/color/string, value, optional [min,max], source line).
- **r7 (selection record)**: the selected scene element `{id, kind, name, startLine, endLine}`.
- **r8 (selection visual)**: a dashed bounding box with a name tag on the canvas. The tree row and the code lines are also highlighted.
- **r9 (instruction record)**: one attribute edit `{attr, value}` made in a property inspector.
- **r10 / r11**: the selected parameter row / the new value from a slider, number field or colour picker.
- **r12 (selection record)**: separate from r7. It is the element pinned as the target of a scoped AI edit
  ("✦ Edit with AI"). It is drawn in purple so it stays visible while r7 changes.
- **r13**: a free-text instruction for that element. **r14_1**: the element's dedented source lines (a group includes its children).
  **r14_2**: the model's replacement lines.
- **r15 (instruction record)**: `{task, instruction, snippet, selection, context_code, dsl_spec}`.
- **r2 (instruction record)**: `{task, instruction, current_code?, dsl_spec}`. r2_1 has no code (process 1). r2_2 has the current code (process 6).
- **r16**: a free-text instruction for the whole drawing.

## Process wiring and triggers

- Process 1 runs from a start screen when there is no program. "New drawing" goes back to it.
- Processes 2–6 are always available in one workspace. The design gives no triggers, so each runs when the user acts.
- Process 2 (select + highlight) and process 3 (inspector) share r7. Process 3 is shown only while something is selected.
- Process 4 is independent of r7. Selecting a parameter row opens its editor in place.
- Process 5's human select is an explicit button. Selection alone does not open the AI box.
- In process 3 the final state keeps r7. In practice the selection persists after every edit as long as the element id still exists.
- Tool modify steps (3, 4, 5) validate the new program by parsing it. An invalid result is rejected and the error is shown next to the field, so it never becomes a new version.
- Model calls lock all editing controls. This keeps line-based splicing consistent. A busy bar shows elapsed time and has a Cancel button that aborts the HTTP request and kills the CLI process.
- `~` handling: model output is parsed. On errors the model gets one retry with the parser messages appended. After that the request fails with a visible error. The design has no human review step after the model steps, so valid output is committed directly. A "↻ Regenerate" button reruns the last process 1/6 request with its original base code.
- Versions: every r3 change is appended to a history list (`vN` counter, last 50 kept in localStorage). The design has no revert or compare step, so there is no undo UI.
- Slider drags commit a new version on every change event, so one drag can create many versions.
- Typed parameter values are not clamped to [min, max]. Only the slider is limited to that range.

## Layout and styling

- Top bar: global edit field (process 6), Regenerate, version counter, New drawing.
- Left: scene tree (r4) above the parameter table (r6). Centre: canvas (r5 + r8). Right: inspector (process 3) and scoped AI edit card (process 5). Bottom: read-only, syntax-highlighted code (r3) that scrolls to the selection.
- Light neutral theme. Blue marks selection and purple marks AI actions. System font, monospace for code. No CSS framework.
- The code view is read-only because the design has no human modify on r3.

## Libraries and infrastructure

- Vite + React 19 + TypeScript client. Express 5 server run with `tsx`. vitest unit tests. No state library (React state only).
- The parser, renderer and edit tools are in `shared/` and are used by both client and server. The server uses them to validate model output.
- Model provider: `claude -p --output-format json --tools "" --system-prompt …`, prompt sent on stdin, `CLAUDECODE` removed, run in an empty temp directory, 180 s timeout. All of this is behind `callModel` in `server/model.ts`.
- Persistence: localStorage only. There is no backend database.

## Model prompts (server/compose.ts)

- System prompt (all calls): "answer with exactly one fenced code block tagged shape" plus the full DSL reference (`DSL_SPEC`).
- Generate (r2_1): write a complete program for the description. Use groups for meaningful parts, give every element a descriptive name, and expose 3–8 parameters (sizes with ranges, main colours).
- Generate with code (r2_2): here is the current program. Rewrite it completely to apply the change, keeping the names, structure and parameters the change does not concern.
- Modify snippet (r15): full program for context, the selected lines, and an instruction to return only replacement lines (no canvas/param), allowed to use existing parameters, keeping the element's name.
- Retry suffix: the previous answer plus the parser errors, asking for a corrected version.

## Verification

- `npm test` (7 tests), `npm run typecheck` and `npm run build` pass.
- Live run with the real CLI, driven through the UI with headless Chromium. Process 1 generated a robot face. Process 2 selected via tree and canvas, with overlay and line highlight. Process 3 changed an attribute (v1→v2). Process 4 changed a numeric parameter. Process 5 ran a scoped AI edit (v→v+1, no error). Process 6 ran a global AI edit ("add a speech bubble"), which worked. Every transformation was reachable.

## Did the design remind me of a published system?

Somewhat, but not of one specific system. The combination of code generated from language, a
synchronized structural view (tree), a rendered output and a parameter panel, with selection
highlighting and scoped "edit this part with AI" requests, resembles several systems I know:

- LLM-assisted **CAD / parametric modelling** tools (e.g. work on generating OpenSCAD/CadQuery code with
  parameter sliders and part selection), and
- **bidirectional programming / direct-manipulation editors** such as Sketch-n-Sketch (code ↔ SVG output with
  edits on the output written back into the program), and the general pattern of LLM chart or SVG editors
  that keep a spec and a rendered view in sync.

Choices that came from that background knowledge rather than from the design:

- Exposing named **parameters with [min, max] slider ranges** as the r6 record, and asking the model to declare them
  (parametric-CAD / Sketch-n-Sketch influence).
- Using **SVG** as the visual and a program whose elements map 1:1 to rendered elements (`data-node-id`),
  so clicking the output selects the source (bidirectional-editor influence).
- Treating r14 as the **source lines of the selected element** and splicing the model's rewrite back by line span
  (a common "scoped regeneration" pattern in LLM code-editing tools).
- Treating r4 as a **scene graph / CSG-like tree** with groups.

I did not look up or consult any original system. The DSL, prompts, layout and all code are my own choices for this experiment.
