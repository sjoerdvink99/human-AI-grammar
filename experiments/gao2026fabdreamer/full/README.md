# System X — image → layered cut-and-engrave design

Implementation of the Human-AI grammar design in `design.json`. It covers the three-stage workflow **Decompose → Create → Prepare** and ends with a ZIP of per-layer SVG/PNG fabrication files.

## Run

Requires Node 20+ and a logged-in `claude` CLI on `PATH`. No API key is needed.

```bash
npm install
npm run dev        # API on :5174, UI on http://localhost:5173
# or
npm run build && npm start   # serves the built UI from :5174
npm test           # unit tests for the deterministic tools
npm run typecheck
```

Environment variables:

- `SYSTEMX_MODEL`: CLI model alias (default `sonnet`).
- `SYSTEMX_MAX_CONCURRENT`: parallel CLI calls (default 4).
- `SYSTEMX_DATA`: project directory (default `data/projects`).
- `SYSTEMX_KEEP_TMP`: keep intermediate crops.

## Model provider

Every model step goes through **one function**, `callModel()` in `server/llm.ts`. It runs `claude -p … --output-format json --json-schema …` with `CLAUDECODE` removed from the environment, and passes images as file paths that the CLI reads. The four model roles have separate adapters and system prompts:

| Design actor | Adapter | How it is realized with the CLI |
| --- | --- | --- |
| model_1 vision-language model | `server/models/vlm.ts` | direct: Claude reads the image and answers in JSON |
| model_2 image generation/editing | `server/models/imageModel.ts` | Claude draws **SVG**, which sharp rasterizes. Inpainting is an SVG patch composited through the hole mask over a push-pull pre-fill |
| model_3 segmentation (SAM2) | `server/models/segmenter.ts` | Claude traces polygons in an upscaled crop around the detection box. The polygon is rasterized, then snapped to colour edges (`snapToEdges`) |
| model_4 LLM with tool calling | `server/models/agent.ts` | the tool list goes in the prompt; calls come back as JSON-schema'd `{tool, args}` |

To swap in a real provider (e.g. a raster image model or a SAM2 endpoint), replace the body of the adapter function. The pipeline only sees `RGBA` images and `Mask`s.

## Transformation → code map

| Process | Step | Code |
| --- | --- | --- |
| 1 Generate source image | `[model_2 generate]~` prompt → image_candidates | `imageModel.generateCandidates` via `POST /generate` |
| | `[human select]` → source_image | `StartPanel` candidate grid (`DecomposeView.tsx`) → `POST /candidates/select` |
| 2 Refine source image | `[human specify]` image_update | `RefineBox` (`DecomposeView.tsx`) |
| | `[model_2 modify]~` → source_image_2 (kept as a new version) | `imageModel.editImage` via `POST /refine`; versions in `SourceVersions`, each with its own `Workspace` |
| 3 Propose/revise layers | `[model_1 generate]~` → layer_plan (auto-triggered on upload/select) | `vlm.proposeLayers` (`startProposeLayers` in `server/index.ts`) |
| | `[human specify]` layer_change → `[model_1 modify]~` (loop) | `PlanPanel` chat → `vlm.reviseLayers` via `POST /plan/change`; earlier plans kept, with revert |
| 4 Decompose & reconstruct | `[human select]` → confirmed_layers | "Confirm layers & decompose" → `POST /confirm` |
| | `[model_1 extract]` layer_items, `[model_1 extract]` style | `vlm.describeItems`, `vlm.describeStyle` in `pipeline/decompose.ts` |
| | `[tool_1 modify]` → work_image | `runDecompose` (initialize work image) |
| | `[model_1 extract]` → detection_prompts | `vlm.locateElements` (per layer, front → back) |
| | `[model_3 extract]` → masks | `segmenter.segment` |
| | `[tool_1 translate]` → segments_2 | `tools/vectorize.maskToElement` (d3-contour + simplify) |
| | `[model_1 generate]~` → fill_prompt | `vlm.fillPrompt` |
| | `[model_2 modify]~` → work_image (loop to the next layer) | `imageModel.inpaintPatch` + `raster.pushPullFill`/`compositeMasked` |
| 5 Recover segmentations | `[tool_1 evaluate]` mask_quality | `tools/maskQuality.evaluateMask` (confidence, box IoU, area ratio) |
| | `[model_3 modify]` → refined_masks → `[tool_1 evaluate]` | `segmenter.refine` in `pipeline/recover.ts` |
| | `[model_2 generate]~` isolated → `[tool_1 extract]` → `[tool_1 translate]` | `recover.fallbackMask` (`imageModel.isolateOnWhite` + `raster.diffMask`) → `maskToElement` |
| 6 Grab element | `[model_2 generate]~` → grab_candidates | `imageModel.generateGrabCandidates` (`pipeline/elementOps.grabCandidates`) |
| | `[human select]` → `[model_1 evaluate]` occlusion → `[model_2 generate]~` isolated_grab → `[tool_1 extract]` → `[tool_1 translate]` | `GrabPanel` → `elementOps.grabSelect` (`vlm.evaluateOcclusion`, `isolateOnWhite`, `diffMask`, `maskToElement`) |
| 7 Compose with live preview | `[tool_2 compose]` canvas (Auto Layout) | `shared/autoLayout.ts` (end of decomposition and the "Auto Layout" button) |
| | `[tool_2 translate]` preview | `web/src/components/Preview3D.tsx` (three.js, refreshes on every change) |
| | `[human modify]` canvas_1 → canvas_2 (loop) | `LayerCanvas.tsx` (move/scale/rotate), `LayersList`/`Inspector` (regroup, order, frame), `PUT /canvas`; versions in `canvasHistory` with Undo |
| 8 Repair element | `[human select]` repair_target | Inspector "Repair" button |
| | `[tool_1 extract]` crop → `[model_2 modify]~` → `[tool_1 translate]` | `elementOps.repairElement` |
| 9 Split element | `[human select]` + `[human specify]` | Inspector "Split into parts" chat |
| | `[model_1 extract]` part_prompts → `[model_3 extract]` part_masks → `[tool_1 translate]` | `elementOps.splitElement` (`vlm.locateParts`, `segmenter.segment`, `maskToElement`) |
| 10 Fabrication constraints | `[tool_3 evaluate]` (auto on entering Prepare) | `tools/constraints.checkConstraints` (floating components, morphological thin-feature test) |
| | `[model_4 generate]~` constraint_report | `agent.explainIssues` |
| | `[human select]` resolution | `AgentPanel` option buttons / free text / "Proceed to export" (`PrepareView.tsx`) |
| | `[model_4 translate]` fix_call → `[tool_3 execute]` → re-check (loop) | `agent.toFixCalls` → `tools/geometryFixes.executeFix` → `checkAndExplain` (`POST /prepare/resolve`) |
| 11 Export | `[tool_1 translate]` layer_svgs + layer_pngs | `tools/export.renderLayerFiles` |
| | `[human select]` export_choice | `ExportPanel` (layers and formats) |
| | `[tool_1 compose]` export_zip | `tools/export.composeZip` → `POST /export/zip` |

Planning notes are in `PLAN.md`. Decisions the design left open are listed in `NOTES.md`.
