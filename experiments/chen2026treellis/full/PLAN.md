# PLAN — System X (text-to-3D assembly editor)

Design: `design.json` (6 processes, no references, no images).

## Stack (repository was empty — recommended default taken)

- Frontend: Vite + React 18 + TypeScript, plain `three` with `OrbitControls` for the 3D view.
- Backend: Node + Express (TypeScript via `tsx`), one endpoint per model operation.
- Model provider: the local Claude Code CLI (`claude -p --output-format json`, spawned with `CLAUDECODE` removed from the env), wrapped in a single function `callModel()` in `server/model.ts` so the provider can be swapped.
- Shared scene code (types, validation, tree operations) in `src/shared/` used by both client and server.
- Tests: Vitest for the deterministic tool steps (validate, extract, patch, structure edits, parameter edits).
- Persistence: none beyond the browser session (current scene kept in `localStorage` so a reload keeps work).

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| prompt | `string` | user's description of the object | `src/components/PromptBar.tsx` |
| generation_input | `GenerationInput {prompt, currentScene?, constraints}` | request sent to model | `server/compose.ts` |
| scene | `Scene` (JSON text, formal) | tree of named groups/parts with geometry, transforms, color | `src/shared/scene.ts` |
| structure_tree | derived from `scene.root` | assembly hierarchy, rendered as outline | `src/components/StructureTree.tsx` |
| model_view | three.js scene graph built from `scene` | rendered 3D view | `src/components/ModelView.tsx` |
| parameters | `SceneNode` fields of the selected node | name, color, geometry, position, rotation, scale | `src/components/ParameterPanel.tsx` |
| selected_node | `{nodeId}` | clicked part/tree node | `src/App.tsx` state `selectedNodeId` |
| linked_highlight | derived set of node ids (selected subtree) | highlight in 3D + tree | `src/shared/scene.ts#subtreeIds` |
| parameter_edit | `ParameterEdit {nodeId, field, value}` | user change to a part | `src/shared/scene.ts#applyParameterEdit` |
| structure_target | `{nodeId}` | node chosen to restructure | `App.tsx` (same selection, used in tree toolbar) |
| structure_edit | `StructureEdit` union (add part/group, delete, move up/down, indent/outdent, reparent by drag) | hierarchy change | `src/shared/scene.ts#applyStructureEdit` |
| ai_target | `{nodeId}` | node chosen for local AI edit | `App.tsx` |
| local_request | `string` | text description of local change | `src/components/LocalEditBox.tsx` |
| subtree | `SceneNode` JSON | the scene under the selected node | `src/shared/scene.ts#extractSubtree` |
| scoped_input | `ScopedInput {subtree, request, context}` | request sent to model for local edit | `server/compose.ts` |
| followup_prompt | `string` | new global prompt with current scene as context | `src/components/PromptBar.tsx` |

## Transformations

| Process | Step | Function / component | File |
| --- | --- | --- | --- |
| 1 | [tool compose] | `composeGenerationInput` | `server/compose.ts` |
| 1 | [model generate]~ | `POST /api/generate` → `generateScene` → `callModel` | `server/index.ts`, `server/model.ts` |
| 1,3,4,5,6 | [tool translate] | `parseScene` + `buildThreeScene` + `StructureTree` + `ParameterPanel` | `src/shared/scene.ts`, `src/three/build.ts` |
| 2 | [human select] | click in `ModelView` (raycast) or row in `StructureTree` | components |
| 2 | [tool translate] | `subtreeIds` → highlight in both views | `src/shared/scene.ts` |
| 3 | [human specify] | `ParameterPanel` inputs | `ParameterPanel.tsx` |
| 3 | [tool modify] | `applyParameterEdit` | `src/shared/scene.ts` |
| 4 | [human select] + [human specify] | `StructureTree` selection + toolbar / drag-and-drop | `StructureTree.tsx` |
| 4 | [tool modify] | `applyStructureEdit` | `src/shared/scene.ts` |
| 5 | [human select] + [human specify] | selection + `LocalEditBox` | `LocalEditBox.tsx` |
| 5 | [tool extract] | `extractSubtree` | `src/shared/scene.ts` |
| 5 | [tool compose] | `composeScopedInput` | `server/compose.ts` |
| 5 | [model modify]~ | `POST /api/edit-node` → `callModel` | `server/index.ts` |
| 5 | [tool modify] | `patchSubtree` | `src/shared/scene.ts` |
| 6 | [human specify] | `PromptBar` in follow-up mode | `PromptBar.tsx` |
| 6 | [tool compose] | `composeGenerationInput(prompt, currentScene)` | `server/compose.ts` |
| 6 | [model generate]~ | `POST /api/generate` with `currentScene` | `server/index.ts` |

## Layout

Three-column workspace: left = Structure Tree (with structure toolbar), centre = 3D view with prompt bar on top, right = Parameter Panel + Local AI edit box; a collapsible bottom drawer shows the scene text (syntax-highlighted JSON).

## Open choices (defaults taken)

- Scene format: JSON (validated on server and client); primitives box, sphere, cylinder, cone, torus, capsule; rotations in degrees; colors hex.
- Model outputs are validated; on invalid output the server retries once with the validation error, then reports the error.
- No undo/version history (not in the design); a scene replace is committed directly since no human review step follows the model step in the design.
