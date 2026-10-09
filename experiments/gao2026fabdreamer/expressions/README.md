# LayerCraft (System X)

An implementation of `design.json` (Human-AI grammar, 11 processes). You describe a scene and get
generated images. You pick one, refine it, and agree on a depth-layer plan with the model. The app then
peels the image into cuttable layers (detect → segment → remove & fill, front to back). You arrange the
pieces on a layered canvas, check them against material constraints with an AI advisor, and export one
cut file per layer.

## Run

```bash
npm install
npm run dev        # API on :18923 (PORT to override), UI on http://localhost:5173
# or
npm run build && npm start   # serves the built UI from the API server on :18923
npm test           # unit tests for the deterministic tools
npm run typecheck
```

You need the Claude Code CLI (`claude`) installed and logged in. There is no API key: every model step
runs `claude -p --output-format json --json-schema …` with `CLAUDECODE` removed from the environment.
That happens in one function, `callModel()` in `server/model.ts`. Replace `runClaudeCli()` there to swap
providers. You can override the model per role with `MODEL_1`…`MODEL_4` (defaults: sonnet, sonnet,
sonnet, haiku).

Project state lives in memory and is mirrored to `data/project.json`.

## Design → code map

Model roles: **model_1** = vision-language analyst, **model_2** = image generator/editor (draws SVG),
**model_3** = promptable segmenter (returns SVG shape ids / polygons), **model_4** = fabrication advisor.
**tool_1** = raster/vector tools (`server/svg.ts`, `server/mask.ts`), **tool_2** = canvas composer/renderer,
**tool_3** = constraint checker and fix executor (`server/constraints.ts`).

| Process | Transformation | Code |
| --- | --- | --- |
| P1 | `[model_2 generate]~` prompt → image_candidates* | `p1Generate` (server/processes.ts) → `ops.generateImage` |
| P1 | `[human select]` → source_image | ImageView gallery → `p1Select` |
| P2 | `[human specify]` image_update | ImageView "Change something" |
| P2 | `[model_2 modify]~` → source_image_2 | `p2Modify` → `ops.modifyImage`; versions + revert (`p2Revert`) |
| P3 | `[model_1 generate]~` → layer_plan | `p3Generate` → `ops.generateLayerPlan` |
| P3 | `[human specify]` layer_change → `[model_1 modify]~` (loop) | PlanView "Revise again" → `p3Modify` → `ops.modifyLayerPlan`; plan versions kept |
| P4 | `[human select]` → confirmed_layers | PlanView checkboxes → `POST /api/build` |
| P4 | `[model_1 extract]` → layer_items*, `[model_1 extract]` → style | `runLayerPipeline` (server/pipeline.ts) → `ops.extractLayerItems`, `ops.extractStyle` |
| P4 | `[tool_1 modify]` → work_image + segments | `toImageArtifact` (normalize + id every shape) |
| P4 | loop per layer front→back: `[model_1 extract]` detection_prompts → `[model_3 extract]` masks → `[tool_1 translate]` segments → `[model_1 generate]~` fill_prompt → `[model_2 modify]~` work_image | `ops.extractDetectionPrompts`, `ops.segment`, `resultToMask` + `maskToSegment`, `ops.generateFillPrompt`, `ops.inpaintWorkImage` (+ enforced `removeIds`) |
| P5 | `[tool_1 evaluate]` mask_quality → `[model_3 modify]` refined_masks → `[tool_1 evaluate]` → `[model_2 generate]~` isolated_elements → `[tool_1 extract]` fallback_masks → `[tool_1 translate]` | `ensureMaskQuality` (pipeline.ts): `evaluateMask`, `ops.segment(feedback)`, `ops.generateIsolatedElement`, `foregroundMask`, `maskToSegment`. Runs inside P4 whenever a mask fails the check |
| P6 | `[model_2 generate]~` grab_candidates* → `[human select]` → `[model_1 evaluate]` occlusion → `[model_2 generate]~` isolated_grab → `[tool_1 extract]` grab_mask → `[tool_1 translate]` grab_element | GrabPanel → `p6Generate`, `p6Select` (`ops.evaluateOcclusion`, `ops.generateIsolatedGrab`, `foregroundMask`, `maskToSegment`) |
| P7 | `[tool_2 compose]` segments → canvas | `composeCanvas` (server/store.ts), runs at the end of P4 |
| P7 | `[tool_2 translate]` canvas → preview | `renderPreview` / `layerSvg` (src/preview.ts) |
| P7 | `[human modify]` canvas (loop) | CanvasView drag/recolour/scale/layer/delete/reorder/place grab → `p7Modify`; undo via `canvasHistory` |
| P8 | `[human select]` repair_target → `[tool_1 extract]` element_crop → `[model_2 modify]~` repaired_element → `[tool_1 translate]` repaired_geometry | CanvasView "Repair piece" → `p8Repair` (`cropSvg`, `ops.repairElement`, `foregroundMask` + `uncrop`) |
| P9 | `[human select]` + `[human specify]` → `[model_1 extract]` part_prompts → `[model_3 extract]` part_masks → `[tool_1 translate]` split_parts | CanvasView "Split piece" → `p9Split` (`ops.extractPartPrompts`, `ops.segment(polygonsOnly)`, `assignRemainder`) |
| P10 | `[tool_3 evaluate]` → constraint_issues* → `[model_4 generate]~` constraint_report | FabricationView "Check" → `evaluateConstraints`, `ops.generateConstraintReport` |
| P10 | `[human select]` resolution → `[model_4 translate]` fix_call → `[tool_3 execute]` (loop: re-check) | issue radio + Apply → `POST /api/fix` → `ops.translateResolution`, `validateFixCall`, `executeFix`, then `checkAndReport` again |
| P11 | `[tool_1 translate]` → layer_svgs* + layer_pngs* → `[human select]` export_choice → `[tool_1 compose]` export_zip | ExportView → `translateLayers`, `composeZip` (server/exporter.ts) |

The right-hand "Process trace" panel shows each running job's steps, labelled with these grammar steps.
