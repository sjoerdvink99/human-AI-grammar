# Scene Studio (System X)

An implementation of the Human-AI grammar design in `design.json`. You describe a 3D scene in words.
A model writes it as code in a small scene language (SceneScript). The app turns the code into a
structure tree, a 3D view and per-part parameters, all linked to each other. You can then edit the
scene by selecting parts, changing parameters, editing the structure, asking the AI to change one
part, or asking for changes to the whole scene.

## Run

```bash
npm install
npm run dev        # API on :3001, web UI on http://localhost:5173
npm test           # self-test of the deterministic tool steps
npm run build      # type check + production bundle
npm start          # after build: serves dist/ and the API on :3001
```

Model steps call the local Claude Code CLI (`claude -p --output-format json`, with `CLAUDECODE`
removed from the environment). The provider sits behind `callModel()` in `server/model.ts`.
Optional environment variables: `CLAUDE_MODEL` and `MODEL_TIMEOUT_MS`.

## Design → code

| Process | Step | Code |
| --- | --- | --- |
| 1 | `(prompt_1)` | start screen textarea, `src/App.tsx` |
| 1 | `[tool compose]` → `generation_input_1` | `composeGenerationInput` in `shared/compose.ts` |
| 1 | `[model generate]~` → `scene_1` | `generateScene` in `server/operations.ts` (`POST /api/generate`): validated by parsing, with one repair retry |
| 1–6 | `[tool translate]` → `structure_tree_1 + model_view_1 + parameters_1` | `translateScene` / `extractParameters` in `shared/scene.ts`, `ModelView` in `src/ModelView.tsx` |
| 2 | `[human select]` → `selected_node_1` | click a tree row (`src/StructureTree.tsx`), an object (`src/ModelView.tsx`) or a code line (`src/CodeView.tsx`) |
| 2 | `[tool translate]` → `linked_highlight_1` | yellow box and tint in `ModelView`, line span in `CodeView`, highlighted tree row |
| 3 | `[human specify]` → `parameter_edit_1` | `src/ParameterPanel.tsx` |
| 3 | `[tool modify]` → `scene_2` | `applyParameterEdit` in `shared/edits.ts` |
| 4 | `[human select]` → `structure_target_1` | the ⋯ menu on a tree row |
| 4 | `[human specify]` → `structure_edit_1` | menu items: add child, duplicate, move up/down, wrap in group, ungroup, delete |
| 4 | `[tool modify]` → `scene_2` | `applyStructureEdit` in `shared/edits.ts` |
| 5 | `[human select]` → `ai_target_1` | the ✦ button on a tree row |
| 5 | `[human specify]` → `local_request_1` | `src/AiEditPanel.tsx` |
| 5 | `[tool extract]` → `subtree_1` | `extractSubtree` in `shared/scene.ts` |
| 5 | `[tool compose]` → `scoped_input_1` | `composeScopedInput` in `shared/compose.ts` |
| 5 | `[model modify]~` → `subtree_2` | `modifySubtree` in `server/operations.ts` (`POST /api/modify-subtree`) |
| 5 | `[tool modify]` → `scene_2` | `replaceSubtree` in `shared/edits.ts` |
| 6 | `[human specify]` → `followup_prompt_1` | the header input, `src/App.tsx` |
| 6 | `[tool compose]` → `generation_input_2` | `composeGenerationInput(prompt, currentScene)` |
| 6 | `[model generate]~` → `scene_2` | `generateScene` (follow-up mode) |

Every loop back to `scene_1` goes through `commitScene` in `src/App.tsx`. It keeps earlier versions
in `sceneHistory`; the version counter is shown in the header.
