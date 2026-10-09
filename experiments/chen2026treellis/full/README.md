# System X — text to editable 3D assemblies

Generate a 3D model from a text prompt as an **editable assembly tree** in a textual scene format, then inspect and refine it through synchronized 3D, structure-tree and parameter views: direct parameter edits, manual structure edits, node-scoped AI edits, or global re-prompting with the current scene as context.

Implemented from `design.json` (Human-AI grammar design, 6 processes). See `PLAN.md` and `NOTES.md`.

## Run

Requires Node 20+ and the Claude Code CLI (`claude`) logged in on this machine.

```bash
npm install
npm run dev        # server on :3001 + Vite on http://localhost:5173
# or
npm run build && npm start   # single server on http://localhost:3001
npm test           # unit tests for the deterministic tool steps
```

Environment: `PORT`, `MODEL` (passed to `claude --model`), `CLAUDE_BIN` (path to the CLI).

All model calls go through `callModel()` in `server/model.ts`, which spawns `claude -p --output-format json` with `CLAUDECODE` removed from the environment. Swap the provider by changing that one function.

## Design → code

| Process | Transformation | Implementation |
| --- | --- | --- |
| 1 Generate initial model | `[tool compose]` prompt → generation_input | `composeGenerationInput()` — `server/compose.ts` |
| | `[model generate]~` → scene | `POST /api/generate` → `callValidated()` + `normalizeScene()` — `server/index.ts`, `src/shared/scene.ts` |
| | `[tool translate]` scene → structure_tree + model_view + parameters | `buildThreeScene()` (`src/three/build.ts`), `StructureTree`, `ModelView`, `ParameterPanel` |
| 2 Inspect and select | `[human select]` | click/raycast in `src/components/ModelView.tsx`, row click in `src/components/StructureTree.tsx` |
| | `[tool translate]` → linked_highlight | `subtreeIds()` (`src/shared/scene.ts`) → emissive + bounding box in 3D, row highlight/expand/scroll in tree, line range in scene text |
| 3 Adjust part parameters | `[human specify]` parameter_edit | `src/components/ParameterPanel.tsx` |
| | `[tool modify]` → scene_2 | `applyParameterEdit()` — `src/shared/scene.ts` |
| | `[tool translate]` | React re-render + `ModelView` rebuild |
| 4 Edit structure manually | `[human select]` structure_target | tree selection (`StructureTree.tsx`) |
| | `[human specify]` structure_edit | tree toolbar + drag-and-drop (`StructureTree.tsx`) |
| | `[tool modify]` → scene_2 | `applyStructureEdit()` — `src/shared/scene.ts` |
| 5 Refine subassembly with AI | `[human select]` ai_target, `[human specify]` local_request | selection + `src/components/LocalEditBox.tsx` |
| | `[tool extract]` → subtree | `extractSubtree()` — `src/shared/scene.ts` (called in `POST /api/edit-node`) |
| | `[tool compose]` → scoped_input | `composeScopedInput()` — `server/compose.ts` |
| | `[model modify]~` → subtree_2 | `callModel()` via `callValidated()` — `server/index.ts` |
| | `[tool modify]` → scene_2 | `patchSubtree()` — `src/shared/scene.ts` |
| 6 Regenerate with context | `[human specify]` followup_prompt | `src/components/PromptBar.tsx` (“Regenerate” once a scene exists) |
| | `[tool compose]` → generation_input_2 | `composeGenerationInput(prompt, currentScene)` |
| | `[model generate]~` → scene_2 | `POST /api/generate` with `currentScene` |
