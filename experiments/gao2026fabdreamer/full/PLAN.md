# PLAN — System X (image → layered cut-and-engrave design)

The design has no references and no images. Defaults below were taken without waiting for confirmation (per the experiment instructions).

## Stack (empty repo → minimal stack)

- **Backend**: Node 20 + Express, TypeScript run with `tsx`. `sharp` for raster work, `d3-contour` + `simplify-js` for mask→vector, `jszip` for export.
- **Frontend**: React + Vite + TypeScript, `three` for the 3D preview, plain SVG for the 2D layer canvas.
- **Models**: every model step goes through one function, `callModel()` in `server/llm.ts`, which runs `claude -p --output-format json --json-schema …` with `CLAUDECODE` removed from the environment. Images are passed as file paths the CLI reads with its `Read` tool.
- **Persistence**: one JSON file plus PNG files per project under `data/projects/<id>/`.
- **Long steps** run as background jobs. The client polls `/api/jobs/:id` and shows a progress log.

### Substitutions forced by "only the Claude CLI is available"

| Design actor | Role in design | Realization here |
| --- | --- | --- |
| model_1 VLM | plan, describe, locate, evaluate | Claude (reads image files) |
| model_2 image gen/edit | candidates, refinements, inpainting, isolation redraws | Claude writes **SVG** illustrations, which are rasterized with sharp. Inpainting: Claude writes an SVG patch for the hole region, composited through the mask over a deterministic push-pull pre-fill |
| model_3 segmentation (SAM2) | masks from detection prompts | Claude returns a polygon outline for a crop around each detection box. The polygon is rasterized to a mask and comes with a model-reported confidence |
| model_4 LLM with tool calling | report + translate resolution into tool call | Claude with tool schemas embedded in the prompt and a JSON-schema'd `{tool, args}` output |

All four sit behind `server/models/*.ts`, so a real provider (e.g. SAM2, an image model) can replace one adapter without touching the pipeline.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| prompt | string | text description | shared/types.ts `Project.prompt` |
| image_candidates | `string[]` (png files) | 3 generated images | `Project.imageCandidates` |
| source_image | `SourceVersion[]` | versions {id, file, parentId, instruction} | `Project.sourceVersions` |
| image_update | string | change request | `SourceVersion.instruction` |
| layer_plan | `LayerPlan` {layers[{id,name,depth,elements[{id,name,description}]}]} + history | per workspace | `Workspace.layerPlan/layerPlanHistory` |
| layer_change | string | chat message | `Workspace.planChat` |
| confirmed_layers | `LayerPlan` | frozen plan | `Workspace.confirmedLayers` |
| layer_items | `LayerItem[]` | per-element visual descriptions | `Workspace.layerItems` |
| style | string | style description | `Workspace.style` |
| work_image | png versions | image with extracted layers removed & filled | `Workspace.workImages` |
| segments | `Element[]` | vector path + mask + texture + layer | `Workspace.elements` |
| detection_prompts | `DetectionPrompt[]` {itemId,label,box} | per layer | decomposition log / `server/pipeline/decompose.ts` |
| masks / refined_masks / fallback_masks | `MaskResult` (png mask + polygon + confidence) | per element | `server/pipeline/*` |
| mask_quality | `MaskQuality` {confidence, bboxIoU, areaRatio, pass} | per element | `Element.quality` |
| fill_prompt | string | inpainting prompt | decomposition log |
| isolated_elements | png | redraw on plain bg | `server/pipeline/recover.ts` |
| grab_* | request string, candidate pngs, chosen png, occlusion `'occluded'|'complete'`, isolated png, mask, Element | `Workspace.grab` |
| canvas | `Canvas` {width,height,layers[{id,name,depth,frame,elementIds}]} + element transforms + history | `Workspace.canvas`, `Workspace.canvasHistory` |
| preview | three.js scene | `web/src/components/Preview3D.tsx` |
| repair_target / split_target | element id | UI selection |
| element_crop, repaired_element, repaired_geometry | png, png, Element geometry | `server/pipeline/repair.ts` |
| split_request, part_prompts, part_masks, split_parts | string, `DetectionPrompt[]`, masks, `Element[]` | `server/pipeline/split.ts` |
| material_settings | `MaterialSettings` {material, thicknessMm, minFeatureMm, sheetWidthMm} | `Workspace.material` |
| constraint_issues | `ConstraintIssue[]` | `Workspace.prepare.issues` |
| constraint_report | `{report, options[]}` | `Workspace.prepare.report` |
| resolution | `{optionId? , text?}` | `Workspace.prepare.chat` |
| fix_call | `{tool, args}` | `Workspace.prepare.chat` |
| layer_svgs / layer_pngs | strings / pngs | `server/tools/export.ts` |
| export_choice | `{formats, layerIds}` | Export panel |
| export_zip | zip file | `/api/.../export.zip` |

## Transformations (process order)

| # | actor op | function / component |
| --- | --- | --- |
| P1 | model_2 generate~ | `models/imageModel.generateCandidates` ← `POST /generate` |
| P1 | human select | `StartView` candidate grid |
| P2 | human specify | `SourcePanel` refine box |
| P2 | model_2 modify~ | `imageModel.editImage` |
| P3 | model_1 generate~ | `models/vlm.proposeLayers` (auto-triggered when a source version has no plan) |
| P3 | human specify / model_1 modify~ | `PlanPanel` chat → `vlm.reviseLayers` (loop) |
| P4 | human select | "Confirm layers" button |
| P4 | model_1 extract ×2 | `vlm.describeItems`, `vlm.describeStyle` |
| P4 | tool_1 modify | `pipeline/decompose.initWorkImage` |
| P4 | model_1 extract | `vlm.locateElements` (per layer, front→back) |
| P4 | model_3 extract | `models/segmenter.segment` |
| P4 | tool_1 translate | `tools/vectorize.maskToElement` |
| P4 | model_1 generate~ | `vlm.fillPrompt` |
| P4 | model_2 modify~ | `imageModel.inpaint` (loop to next layer) |
| P5 | tool_1 evaluate | `tools/maskQuality.evaluateMask` |
| P5 | model_3 modify | `segmenter.refine` |
| P5 | model_2 generate~ | `imageModel.isolate` |
| P5 | tool_1 extract / translate | `tools/raster.diffMask`, `vectorize.maskToElement` |
| P6 | model_2 generate~ → human select → model_1 evaluate → model_2 generate~ → tool_1 extract → translate | `pipeline/grab.ts`, `GrabPanel` |
| P7 | tool_2 compose | `web/src/lib/autoLayout.ts` (Auto Layout) |
| P7 | tool_2 translate | `Preview3D.tsx` (live) |
| P7 | human modify | `LayerCanvas.tsx` (drag/scale/rotate/regroup), versions kept for undo |
| P8 | human select → tool_1 extract → model_2 modify~ → tool_1 translate | `pipeline/repair.ts`, Inspector "Repair edges" |
| P9 | human select → human specify → model_1 extract → model_3 extract → tool_1 translate | `pipeline/split.ts`, Inspector "Split" chat |
| P10 | tool_3 evaluate | `tools/constraints.checkConstraints` (auto on entering Prepare) |
| P10 | model_4 generate~ | `models/agent.explainIssues` |
| P10 | human select | `PreparePanel` option buttons / free text / "Proceed to export" |
| P10 | model_4 translate | `agent.toFixCall` |
| P10 | tool_3 execute | `tools/geometryFixes.executeFix`, then re-check (loop) |
| P11 | tool_1 translate | `tools/export.renderLayerFiles` |
| P11 | human select | `ExportPanel` choices |
| P11 | tool_1 compose | `tools/export.zip` |

## Open choices (defaults taken)

- Layout: three tabs **Decompose / Create / Prepare** matching the goal's three stages.
- Canvas space is the source image in pixels, normalized to at most 768 px on the long side. Physical size comes from `sheetWidthMm`.
- Material presets: paper, cardstock, 3 mm plywood, 3 mm acrylic. Each preset sets a default minimum feature width the user can edit.
- Floating = connected component of a layer's cut piece not attached to that layer's largest piece (the frame counts as part of the piece when enabled). Thin = removed by morphological opening at minFeatureMm.
- Export: per layer, an SVG in mm with red hairline cut paths and blue engrave paths, plus a PNG texture render. Both go into one ZIP.
- No auth. Single user, local only.
