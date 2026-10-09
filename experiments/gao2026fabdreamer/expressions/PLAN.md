# PLAN — System X (implementation of design.json)

The design has no goal, descriptions, representation notes, references or images. From the identifiers
(`layer_plan`, `segments`, `canvas`, `material_settings`, `constraint_issues`, `layer_svgs`, `export_zip`)
I read it as: **generate an illustration, decompose it into depth layers of cuttable shapes,
arrange them on a layered canvas, check them against fabrication (material) constraints, and export per-layer
cut files** — a layered papercut / laser-cut "shadow box" maker. I take that reading as the default and keep every
step of the design. I don't add any steps.

## Stack (repository was empty)

- Frontend: Vite + React + TypeScript (`src/`)
- Backend: Node + Express + TypeScript run with `tsx` (`server/`)
- Shared types: `shared/types.ts`
- Raster/geometry tools: `@resvg/resvg-js` (SVG → pixels/PNG), `@xmldom/xmldom` (SVG DOM), own mask
  morphology + contour tracer, `jszip` (export), `zod` (validating model output)
- Tests: `vitest`

## Model provider

There's no API key, so every model step goes through **one function**, `callModel(role, request)` in
`server/model.ts`. It runs `claude -p --output-format json --json-schema … --tools ""` (or `--tools Read`
when an image is attached) with `CLAUDECODE` removed from the environment. The JSON comes back in
`structured_output` and is validated with zod. Roles have separate configurations:

| Role | Purpose | Default model |
| --- | --- | --- |
| model_1 | vision–language planner/analyst (layer plan, items, style, prompts, occlusion, part prompts) | sonnet |
| model_2 | image generator / editor. Claude cannot emit pixels, so it **draws SVG** (512×512), which tools rasterize | sonnet |
| model_3 | promptable segmenter: given an image (PNG + SVG source with element ids) and text prompts, returns element ids and/or polygons per prompt | sonnet |
| model_4 | fabrication-constraint advisor (report + translating a chosen resolution into a tool call) | haiku |

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| prompt | `string` | description of the desired illustration | src/views/ImageView.tsx |
| image_candidates | `ImageArtifact[]` | 3 generated SVG+PNG images | server/processes.ts |
| source_image | `ImageArtifact` (versioned list) | chosen image, edited by process 2 | server/store.ts |
| image_update | `string` | edit instruction | ImageView |
| layer_plan | `LayerPlan` (versioned list) | layers back→front: id, name, description, depth, elements[] + rationale | shared/types.ts |
| layer_change | `string` | requested change to the plan | PlanView |
| confirmed_layers | `ConfirmedLayers` | ids + order of layers the user checked | PlanView |
| layer_items | `LayerItem[]` | id, layerId, name, description, color | pipeline.ts |
| style | `string` | art-style description | pipeline.ts |
| work_image | `ImageArtifact` (versions per peel round) | normalized copy of source (ids on every shape) that gets peeled | pipeline.ts |
| segments | `Segment[]` | cut shapes: bbox, mask, traced path, layer, color, offset | shared/types.ts |
| detection_prompts | `DetectionPrompt[]` | itemId, label, prompt text | pipeline.ts |
| masks / refined_masks / fallback_masks / part_masks / grab_mask | `Mask` | binary 512×512 masks (bbox-cropped) | server/mask.ts |
| mask_quality | `MaskQuality[]` | area, components, fill ratio, ok, reasons | pipeline.ts |
| isolated_elements / isolated_grab / repaired_element | `ImageArtifact` | single element on white | processes.ts |
| fallback_segments / grab_element / repaired_geometry / split_parts | `Segment` | as segments | processes.ts |
| fill_prompt | `string` | how to fill behind removed items | pipeline.ts |
| grab_request | `string` | text for an extra element | GrabPanel |
| grab_candidates / grab_image | `ImageArtifact[]` / one | generated element candidates | processes.ts |
| occlusion | `"complete" \| "occluded" \| "cropped"` | judgement | processes.ts |
| canvas | `Canvas` (version history) | layers + segments with offsets | server/store.ts |
| preview | SVG (client) | stacked shadow-box rendering, flat and exploded | src/preview.ts |
| repair_target / split_target | segment id | selected on canvas | CanvasView |
| split_request | `string` | how to split | CanvasView |
| part_prompts | `{name,prompt}[]` | per part | processes.ts |
| material_settings | `MaterialSettings` | material, thickness, artwork width, sheet size, min feature, min part area, max layers | FabricationView |
| constraint_issues | `ConstraintIssue[]` | type, layer/segment, measured, limit, resolution options | server/constraints.ts |
| constraint_report | `string` | model_4 explanation | constraints route |
| resolution | `{issueId, optionId}` | user's choice | FabricationView |
| fix_call | `{tool, args}` | validated against tool registry | server/constraints.ts |
| layer_svgs / layer_pngs | `string[]` / PNG buffers | per-layer cut files | server/exporter.ts |
| export_choice | `"svg" \| "png" \| "both"` | | ExportView |
| export_zip | zip with manifest.json | | server/exporter.ts |

## Transformations (process order)

| # | step | implementation |
| --- | --- | --- |
| P1 | model_2 generate ×3 → human select | `generateImageCandidates` (processes.ts), ImageView gallery |
| P2 | human specify → model_2 modify | ImageView edit box → `modifySourceImage` |
| P3 | model_1 generate plan → human specify → model_1 modify (loop) | `generateLayerPlan`, `modifyLayerPlan`, PlanView ("Revise again", history) |
| P4 | human select layers → model_1 extract items → model_1 extract style → tool_1 modify (work image, empty segments) → loop per layer front→back: model_1 extract detection prompts → model_3 extract masks → tool_1 translate → model_1 generate fill prompt → model_2 modify work image | `runLayerPipeline` (pipeline.ts) as background job, BuildView trace |
| P5 | (triggered inside P4 per mask) tool_1 evaluate → model_3 modify → tool_1 evaluate → model_2 generate isolated → tool_1 extract → tool_1 translate | `ensureMaskQuality` (pipeline.ts) |
| P6 | grab request → model_2 generate ×3 → select → model_1 evaluate occlusion → model_2 generate isolated → tool_1 extract → tool_1 translate | `grab*` (processes.ts), GrabPanel; result goes to a "grabbed elements" tray to place on canvas |
| P7 | tool_2 compose canvas → tool_2 translate preview → human modify → re-render (loop) | `composeCanvas` (store), `renderPreview` (src/preview.ts), CanvasView drag/recolor/layer/delete/undo |
| P8 | select element → tool_1 extract crop of source → model_2 modify → tool_1 translate | `repairSegment` |
| P9 | select → specify → model_1 extract part prompts → model_3 extract part masks → tool_1 translate | `splitSegment` |
| P10 | tool_3 evaluate → model_4 generate report → human select resolution → model_4 translate → tool_3 execute (loop: re-evaluate) | constraints.ts, FabricationView |
| P11 | tool_1 translate → human select format → tool_1 compose zip | exporter.ts, ExportView |

## Open choices (defaults taken)

- Persistence: one project kept in memory and mirrored to `data/project.json`.
- Long model chains run as server jobs; the client polls the job and shows each grammar step as it completes.
- Layout: tabbed workflow (Image → Layers → Build → Canvas → Fabricate → Export).
- Image size 512×512; physical size comes from `material_settings.artworkWidthMm`.
