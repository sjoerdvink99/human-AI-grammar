# NOTES — decisions the design did not determine

The design gives the six processes, the representation descriptions and the actor types. Everything below was my choice.

## Stack and libraries
- **Frontend:** Vite 5 + React 18 + TypeScript. No state library: a single `useState` scene in `App.tsx` that every view reads.
- **3D:** plain `three` with `OrbitControls`, not react-three-fiber, to keep the dependencies small.
- **Backend:** Express 5 run with `tsx`. The scene code in `src/shared/` is shared by client and server.
- **Tests:** Vitest. They cover only the deterministic tool steps. Playwright was used once from a temporary directory to walk through the UI; it is not a project dependency.
- **Persistence:** the current scene is saved to `localStorage`. There is no database or file export.

## Data formats
- **Scene format (the "textual scene format"):** JSON tagged `systemx-scene/1`. It has `{format, title, root}`. Each node is `{id, name, kind: group|part, geometry?, position, rotation, scale, color?, children}`.
  - Transforms are relative to the parent.
  - Rotation is XYZ Euler in **degrees**, Y is up, and units are roughly metres.
  - Groups have no geometry or color. Parts may also have children.
- **Primitives:** box, sphere, cylinder, cone, torus, capsule, each with named dimensions. There are no meshes, CSG, extrusions or materials beyond a single hex color.
- **Validation (`normalizeScene`):** it repairs what it safely can: missing transforms, 3-digit hex colors, `{x,y,z}` vectors, duplicate ids made unique, missing dimensions defaulted. It rejects unknown shapes, non-positive dimensions, non-array children and more than 400 nodes.
- **Invalid model output:** the server retries **once** and adds the validation problems to the prompt.
- **parameter_edit:** a discriminated union `{nodeId, field, …}`. Fields are name, color, position/rotation/scale per axis, shape and a single dimension. Changing the shape resets the dimensions to their defaults.
- **structure_edit:** a union of these operations:
  - addPart (with a shape), addGroup, delete, duplicate
  - moveUp, moveDown
  - indent (nest under the previous sibling), outdent
  - wrapInGroup
  - reparent (by drag and drop)
  - The root cannot be moved or deleted.
- **subtree / subtree_2:** the JSON of one node. The patch keeps the target's id at the root of the replacement, and child ids that clash with the rest of the scene are renamed. Only that region changes, which the end-to-end check confirmed.

## Model prompts (`server/compose.ts`)
- **generation_input:** a system prompt with the scene format spec and modelling rules:
  - build meaningful subassemblies 2–4 levels deep, with specific names and unique ids
  - rest the object on y=0, centred, 0.5–5 units in size
  - no floating parts, 3–60 parts
  - output JSON only

  The user message is "Create a complete scene for this object: …".
- **generation_input_2 (process 6):** the same system prompt. The user message contains the full current scene JSON and asks for a complete replacement that keeps whatever the new description does not change.
- **scoped_input (process 5):** a separate system prompt for local edits. It asks the model to:
  - return only the replacement Node
  - keep the root id and transform
  - change only what was asked

  The user message has the object title, the path of ancestor names (e.g. `Table > Legs`), the subtree JSON and the request. I added the ancestor path and title from scene_1 as light context; the design names only "subtree plus change description".
- **CLI flags:** `claude -p --output-format json --system-prompt … --tools "" --no-session-persistence --disable-slash-commands --strict-mcp-config`. The prompt goes in on stdin, and the CLI runs in the OS temp directory so it does not pick up project context.
- **Model and timing:** the model is whatever the CLI defaults to, overridable with `MODEL`. The timeout is 240 s. Observed times were about 20 s for a generation and about 11 s for a local edit.

## Layout and styling
- **Three columns:** Structure Tree on the left, 3D viewport in the centre, Parameters plus "AI edit selected node" on the right.
- **Prompt bar** across the top: "Generate" when there is no scene, "Regenerate" plus "New" once there is one.
- **Scene text:** a collapsible bottom drawer shows the scene JSON with syntax highlighting, line numbers, color swatches, and the selected node's line range highlighted. It is read-only.
- **Look:** light neutral theme, a blue primary for actions, and orange (`#ff8a1f`) as the single selection/highlight color in all views.
- **Empty state:** before the first generation only the viewport and a welcome message are shown.

## Interaction details
- **One shared selection:** `selected_node`, `structure_target` and `ai_target` are a single selection in the UI. The design lists them separately, but they all mean "the node the user picked", and processes may follow each other in any order.
- **Selecting in 3D:**
  - Clicking a part selects it. Clicking the already-selected part climbs to its parent subassembly, which gives a way to pick groups in 3D.
  - Clicking empty space or pressing Esc clears the selection.
  - Drags of more than 4 px count as orbiting, not clicks.
- **linked_highlight:** the whole selected subtree glows in 3D and has a bounding box around it. In the tree the selected row is marked, its descendants are tinted, and collapsed ancestors are expanded and scrolled into view. The scene text highlights the node's lines.
- **Parameter edits apply immediately:** every valid keystroke updates the scene, and you can drag an axis label to scrub its value. This matches "immediately refreshes the views".
- **Structure edits:** applied immediately, and the new or moved node becomes selected. Delete/Backspace deletes the selected node.
- **While a model call runs:** all editing is locked and a viewport overlay shows the elapsed seconds. This prevents a model result from overwriting edits made meanwhile.
- **Committing generated results:** they are applied directly, with no accept/reject step, because the design has no human review step after `[model …]~`.
- **No undo or version history,** because the design has no comparison or revert step. Errors appear in a dismissible banner.
- **Camera:** it re-frames on every global (re)generation, not on local edits.
- **Local-edit suggestion chips:** "make it taller", "add decorative details", "make it look more modern", "split into two parts". These are convenience text only.

## Verification
- `npm run build` (tsc + vite) and `npm test` (9 tests) pass.
- An end-to-end run in headless Chromium against the production server, using real model calls, reached every transformation:
  - P1 generated a desk lamp with 22 nodes.
  - P2 selected nodes from the tree and from a 3D click.
  - P3 renamed a part and changed its position.
  - P4 added and deleted a part.
  - P5 AI-edited the "Base" subassembly.
  - P6 regenerated it as a floor lamp, keeping names and ids.
- There were no page errors. Screenshots are in `docs/screenshots/`.

## Did the design remind me of a published system?

Yes. The description — LLM-generated 3D models as editable assembly trees in a textual scene format, with synchronized model, structure and parameter views, and node-scoped AI editing alongside global re-prompting — strongly resembles recent HCI research prototypes for LLM-driven, part-based 3D modelling. Examples are systems that have an LLM write a hierarchical scene or CAD-like program (e.g. in a JSON or Three.js/OpenSCAD-style representation) and let users edit parts. I cannot name one specific paper with confidence, so I did not knowingly copy any particular system.

Choices influenced by that general knowledge rather than by the design:
- Using **primitive shapes (box/sphere/cylinder/cone/torus/capsule) in a JSON tree** as the scene format, the common approach in LLM-to-3D prototypes, instead of e.g. OpenSCAD code or meshes.
- **Three.js** as the renderer, since web-based tools of this kind typically use it.
- Prompt rules such as "rest on the ground plane", "no floating parts" and "Y up, degrees", which are known failure modes of LLM-generated primitive scenes.
- Keeping ids and the root transform stable during local edits so the patched subtree stays attached.

The three-pane layout, the single shared selection, click-again-to-climb, immediate-apply parameters and the locking during model calls were my own choices, not taken from any system I recall.
