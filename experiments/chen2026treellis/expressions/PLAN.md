# PLAN — System X

The design has no goal, description, representation descriptions, references or images. From the
identifiers (`scene`, `structure_tree`, `model_view`, `parameters`, `subtree`) I infer:
**a text-to-3D-scene editor**. A model writes a scene as code in a small declarative scene language;
the tool layer parses it into a hierarchy (structure tree), renders it (3D model view), and extracts
per-node parameters. The human then edits through linked views: selection, parameter editing,
structural editing, scoped AI edits on a subtree, and follow-up prompts on the whole scene.

## Stack (repository was empty)

- Frontend: Vite + React + TypeScript, Three.js for the 3D view.
- Backend: Node + Express (TypeScript via `tsx`), one endpoint per model operation.
- Model provider: local Claude Code CLI (`claude -p --output-format json`, `CLAUDECODE` removed from
  env) behind a single function `callModel(prompt)` in `server/model.ts`.
- Scene language parser/serializer shared by client and server (`shared/scene.ts`).
- No persistence (in-memory, browser session). No tests framework beyond a small parser self-test script.

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| prompt | `string` | user's description of the scene to build | `src/App.tsx` |
| generation_input | `GenerationInput {mode, prompt, currentScene?}` | composed request for whole-scene generation | `shared/types.ts` |
| scene | `string` (SceneScript code) | the artifact: scene source code, versions kept in `sceneHistory` | `src/App.tsx` |
| structure_tree | `SceneNode` tree | parsed hierarchy of groups and primitives with ids and source spans | `shared/scene.ts` |
| model_view | Three.js canvas | rendered 3D scene | `src/ModelView.tsx` |
| parameters | `Record<nodeId, NodeParams>` | editable attributes per node (position, rotation, scale, size, color…) | `shared/scene.ts` |
| selected_node | `{nodeId, path}` | node the user selected in tree, view or code | `src/App.tsx` |
| linked_highlight | derived | highlight of the selected node in the 3D view (outline/emissive) and code span | `src/ModelView.tsx`, `src/CodeView.tsx` |
| parameter_edit | `{nodeId, key, value}` | one parameter change | `shared/edits.ts` |
| structure_target | `{nodeId}` | node targeted for a structural edit | `src/StructureTree.tsx` |
| structure_edit | `{op, nodeId, ...}` op ∈ add/delete/duplicate/move-up/move-down/rename/wrap-in-group | structural change | `shared/edits.ts` |
| ai_target | `{nodeId}` | node targeted for a scoped AI edit | `src/App.tsx` |
| local_request | `string` | what to change in that subtree | `src/AiEditPanel.tsx` |
| subtree | `string` (SceneScript) | source code of the targeted node only | `shared/scene.ts` |
| scoped_input | `ScopedInput {request, subtree, sceneContext}` | composed request for scoped edit | `shared/types.ts` |
| followup_prompt | `string` | whole-scene follow-up instruction | `src/App.tsx` |

## Transformations

| Process | Step | Implementation | File |
| --- | --- | --- | --- |
| 1 | tool compose | `composeGenerationInput(prompt)` | `shared/compose.ts` |
| 1 | model generate~ | `POST /api/generate` → `generateScene()` (validates by parsing; one repair retry) | `server/operations.ts` |
| 1 | tool translate | `translateScene(code)` → tree + parameters; `ModelView` renders | `shared/scene.ts`, `src/ModelView.tsx` |
| 2 | human select | click node in tree / object in 3D view / line in code | `StructureTree.tsx`, `ModelView.tsx`, `CodeView.tsx` |
| 2 | tool translate | `linked_highlight`: highlight mesh + code span + tree row | `ModelView.tsx`, `CodeView.tsx` |
| 3 | human specify | parameter panel inputs for the selected node | `src/ParameterPanel.tsx` |
| 3 | tool modify | `applyParameterEdit(code, edit)` | `shared/edits.ts` |
| 3 | tool translate | re-parse, selection kept | `src/App.tsx` |
| 4 | human select | choose node in tree (structure target) | `StructureTree.tsx` |
| 4 | human specify | toolbar buttons / add-menu on the tree | `StructureTree.tsx` |
| 4 | tool modify | `applyStructureEdit(code, edit)` | `shared/edits.ts` |
| 5 | human select | "Edit with AI" on a node sets ai_target | `StructureTree.tsx` |
| 5 | human specify | local request text field | `src/AiEditPanel.tsx` |
| 5 | tool extract | `extractSubtree(code, nodeId)` | `shared/scene.ts` |
| 5 | tool compose | `composeScopedInput(...)` | `shared/compose.ts` |
| 5 | model modify~ | `POST /api/modify-subtree` → `modifySubtree()` (validated: single node, parses) | `server/operations.ts` |
| 5 | tool modify | `replaceSubtree(code, nodeId, newSubtree)` | `shared/edits.ts` |
| 6 | human specify | follow-up prompt field | `src/App.tsx` |
| 6 | tool compose | `composeGenerationInput(prompt, currentScene)` | `shared/compose.ts` |
| 6 | model generate~ | `POST /api/generate` (mode = followup) | `server/operations.ts` |

Loops (3–6 end in the start state) are the normal edit cycle: after each edit the views are recomputed
and any process can run again. Earlier scene versions are kept in an array (not exposed as a
step, since the design has no compare/revert step).

## Open choices (defaults taken)

- Domain: 3D scenes of primitive shapes (box, sphere, cylinder, cone, torus, plane) grouped hierarchically.
- Scene language: own small brace-based DSL ("SceneScript"), easy to parse, shown with highlighting.
- Layout: prompt bar top; left structure tree; center 3D view; right parameters + AI edit; bottom code view.
- Model: Claude Code CLI default model.
