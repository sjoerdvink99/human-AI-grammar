# NOTES: decisions the design did not determine

The design gives six process expressions and nothing else: no goal, no description, no
representation descriptions, no references and no images. All of the following are my own choices.

## Domain and data formats

- **What the system is for.** I read `scene`, `model_view` and `structure_tree` as a text-to-3D-scene
  editor. `scene` (artifact formal) is code that describes a 3D scene, and `model_view` (artifact
  visual) is its 3D rendering. Other readings would also fit, for example an SVG or HTML document
  with its DOM tree.
- **Scene language.** I made up a small brace-based DSL called *SceneScript*: `type "name" key=value … { children }`.
  It has 8 node types (`scene`, `group`, `box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`) and a
  fixed set of attributes for each type: transform, material and dimensions. Units are metres, Y is up,
  rotations are in degrees, and colours are `#rrggbb`. I chose my own DSL over OpenSCAD or Three.js
  code so the tool steps can parse, edit and re-serialize it without loss.
- **Canonical form.** Every scene version is stored re-serialized in canonical formatting. Model
  output is canonicalized while it is validated. This keeps the line spans that link code and tree
  stable. Comments in model output are dropped.
- **structure_tree.** Parsed nodes with path-based ids (`0`, `0.1`, `0.1.2`) and source line spans.
  Ids are re-assigned after each structural edit, and the app picks the node to select afterwards.
- **parameters.** For each node, every attribute its type allows, with defaults filled in, plus the name.
- **selected_node / structure_target / ai_target.** I kept these as three separate selection states
  because the design names them separately. `selected_node` is set by clicking a tree row, a 3D object
  or a code line. `structure_target` is the row whose ⋯ menu is open. `ai_target` is the row whose ✦
  button was pressed, and it stays marked with a purple bar.
- **linked_highlight.** A yellow BoxHelper plus an emissive tint on the selected node's meshes, a
  highlighted line span in the code (scrolled into view), and a highlighted tree row.
- **parameter_edit.** `{nodeId, key, value}`. Changes apply right away on each input change, with no
  "apply" button. Number fields can also be changed by dragging their axis label.
- **structure_edit.** `{op, nodeId, …}`, where op is one of add-child (with a type), duplicate, move
  up/down, wrap in group, ungroup (refused if the group has a transform) or delete. The design only
  says "structure edit", so this set of operations is mine. I did not implement drag-and-drop reparenting.
- **generation_input.** `{mode: create|followup, prompt, currentScene?}`.
- **scoped_input.** `{request, subtree, target{nodeId,name,type}, sceneContext}`. The full scene goes
  in as read-only context, because `scene_1` is in the state before the compose step.
- **Version history.** Each committed scene is pushed to `sceneHistory`, and the header shows a
  version counter. There is no undo, compare or revert UI, because the design has no such step.

## Model steps and prompts

- **Provider.** `callModel({system, user})` in `server/model.ts` runs `claude -p --output-format json
  --append-system-prompt …`. The user prompt goes in on stdin, `CLAUDECODE` is removed from the
  environment, and the working directory is `os.tmpdir()` so the CLI does not pick up repository
  context. Timeout is 240 s.
- **System prompt.** "Answer with SceneScript code only, in one ```scenescript block, no tools."
- **Language spec.** Both prompts include the grammar, the attribute table, placement conventions
  (primitives are centred, so something resting on the ground has y = h/2) and a worked example (a small table).
- **Generate (P1).** Spec + "Write a SceneScript scene for this request: …".
- **Generate (P6).** Spec + current scene + "Rewrite the whole scene to apply this request, keeping
  everything else unchanged". The model regenerates the full scene; it does not produce a diff.
- **Modify (P5).** Spec + full scene as context + the target subtree + request. The model must return
  exactly one node; for the root it must be a `scene` node, and for anything else it must not be.
- **Validation of `~` outputs.** Output is extracted from the code fence and parsed against the
  grammar and attribute types. If it fails, the app retries once and passes the parser error back
  to the model. If it fails again, the user sees an error. In P5 the constraint "only the target changes" is
  enforced in code: `replaceSubtree` splices the new node into the target position and leaves
  everything else untouched.
- **No human review before commit.** In the design, no human step comes between the model steps and
  `tool translate`, so results are applied directly. While a model step runs, editing controls are
  disabled and a spinner or overlay is shown. To "regenerate", you resubmit.

## Layout, styling and interaction

- Start screen (P1): a centred prompt with four example prompts. Ctrl/⌘+Enter submits.
- Editor: a header with the follow-up prompt (P6), a "New" button and the version counter. Three
  columns: structure tree on the left; 3D view (top, 60%) and syntax-highlighted code (bottom, 40%)
  in the centre; parameters (P3) and "Edit part with AI" (P5) on the right.
- Dark theme, yellow for selection and purple for the AI target. The code view shows colour swatches.
- 3D view: Three.js with OrbitControls, hemisphere and directional light with shadows, and a grid.
  The camera re-frames after each model generation, ignoring ground planes; it does not re-frame
  after manual edits. Click to select; dragging orbits.
- The AI edit panel has a collapsible preview of exactly the code sent to the model (`subtree_1`).
- The code view is read-only, because the design has no step where a human edits the code directly.

## Libraries

React 19, Vite, TypeScript, three (r18x), Express, tsx, and concurrently. A plain `node:assert`
self-test (`npm test`) covers the tool steps. I used Playwright (installed outside the repo) only for
a one-off end-to-end check of all six processes.

## Verification performed

- `npm test`, `tsc --noEmit` and `vite build` all pass.
- A browser walkthrough with the real Claude CLI covered all six processes: generate a scene;
  select from the tree and from the 3D view, with linked highlight in all three views; edit a
  parameter (the code changes and the selection is kept); duplicate via the structure menu (the tree
  grows); run an AI edit on one part (applied, version goes up); run a follow-up prompt (adds objects).

## Did the design remind me of a published system?

Not of one specific system I could name with confidence. The pattern is: prompt → LLM writes
scene/CAD code → linked views of code, structure tree, 3D render and parameters → direct parameter
edits and LLM edits scoped to a subtree. That reminds me of a family of LLM-assisted 3D/CAD authoring
work: LLMs generating OpenSCAD/CadQuery or Blender Python (e.g. 3D-GPT, SceneCraft, and CAD code-generation
papers), and HCI tools that let users point at part of a program or design and ask an LLM to change
only that part. The OpenSCAD customizer, where parameters are extracted from code, also fits.

Choices that came from that background knowledge rather than from the design:
- reading the domain as 3D scenes built from primitives (box/sphere/cylinder/cone/torus/plane);
- a declarative CSG-like scene language with groups and transforms, and parameters extracted from it;
- the parameter panel with number fields that can be scrubbed, as in 3D tools such as Blender;
- a bounding-box highlight for the selected part in the 3D view.
