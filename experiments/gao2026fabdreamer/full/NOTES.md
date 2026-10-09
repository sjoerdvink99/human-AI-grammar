# NOTES — decisions the design did not determine

The design (`design.json`) fixes the processes, actors, operations and representation contents. It has no references and no images. Everything below was my choice.

## Stack and libraries

- **Backend**: Node 20 + Express in TypeScript, run with `tsx` (no build step for the server).
- **Frontend**: React 19 + Vite. No state library: one `Project` object is fetched from the server, with local copies only where editing needs them (the canvas).
- **Raster work**: `sharp`, which also rasterizes the SVG that model_2 produces.
- **Vectorization**: `d3-contour` (marching squares on the mask) and `simplify-js`.
- **Packaging**: `jszip`.
- **3D preview**: `three` with `OrbitControls`.
- **Tests**: `vitest` (13 unit tests on the deterministic tools). `concurrently` for `npm run dev`.
- **Persistence**: `data/projects/<id>/project.json` plus PNG files. The server keeps an in-memory cache.
- **Long-running steps**: in-memory background jobs; the client polls `GET /api/jobs/:id` every 1.2 s. Jobs don't survive a restart. An interrupted decomposition is marked failed on startup so the user can retry.

## Model realization (forced by "only the Claude CLI is available")

- **One provider function**: `callModel()` in `server/llm.ts`. It spawns `claude -p <prompt> --output-format json --json-schema <schema> --system-prompt <role prompt> --model sonnet --no-session-persistence`, with `CLAUDECODE` deleted from the environment.
  - Images: the prompt lists absolute file paths, and the CLI may only use `Read` (`--allowedTools Read --add-dir <dir>`). Calls without images disallow all tools.
  - Output: read from `structured_output`. If that is missing, the first JSON in `result` is used. Required keys are checked, and a failed call is retried once.
  - Concurrency is capped at 4 calls and each call times out after 4–5 minutes.
- **model_2 (image generation/editing)**: no raster image model is available, so Claude writes an SVG document. It is sanitized (no `<script>`, `<image>`, `foreignObject`, event handlers or external hrefs; size forced) and rasterized. Generated images are therefore flat vector illustrations; I chose that style on purpose because it suits layered cut art.
  - Inpainting: the work image goes to the model with the removed region painted magenta. Claude returns an SVG patch for that region. The patch is composited **only inside the hole mask**, over a deterministic push-pull pre-fill, so the result stays valid if the patch is poor or the call fails.
  - "Isolate on plain background" (processes 5, 6, 8): Claude redraws the object on pure white at the same framing. The mask comes from differencing against white (threshold 40 in RGB distance), followed by closing and hole filling.
- **model_3 (segmentation, SAM2 in the design)**: there is no segmentation model, so Claude traces polygons on a crop around the detection box. The crop is padded by 12%, upscaled to 512 px on its long side, and the box is drawn dashed in cyan. Claude also reports a confidence. The polygon is rasterized and then **snapped to colour edges**: pixels in a band around the outline are re-assigned using colour histograms of the sure-inside and sure-outside regions. That snapping step is my addition inside the segmenter adapter. Refinement (`model_3 modify`) shows the previous mask as a red overlay and names the failed check.
- **model_4 (tool calling)**: the tool list (name, description, argument shape) is written into the prompt. The output schema constrains `tool` to that enum, and calls naming unknown tools are dropped.
- Model choice: `sonnet` alias by default; override with `SYSTEMX_MODEL`.

## Model prompts (summarized; full text in `server/models/*.ts`)

- **System prompts**: model_1 is "vision-language component of a layered cut-art tool; depth 0 = front". model_2 is "produce flat illustration SVG with separated shapes, no text/filters". model_3 is "trace precise outline polygons, 20–80 vertices". model_4 is "friendly fabrication assistant operating geometry tools".
- **Layer proposal**: 3–5 layers. The deepest is the back plate with one background element. Each element gets a name and a one-sentence description, and the response includes a summary message.
- **Revision**: returns the full revised plan, keeping everything the user did not ask to change.
- **Plan validation** (`normalizePlan`): sorts by depth, renumbers depths from 0, caps at 8 layers and 12 elements per layer, requires at least 2 layers, and assigns stable ids (`L0`, `L0E1`).
- **Detection**: tight pixel boxes `[x0,y0,x1,y1]`, one per instance, omitting invisible items. Boxes are clamped and normalized, and boxes smaller than 4 px are dropped.
- **Fill prompt**: 1–2 sentences on what continues behind the removed objects. It is given the style and the names of the remaining layers.
- **Occlusion**: an enum `occluded | complete` plus a reason.
- **Agent report**: 3–6 sentences on the problem, why it matters for the material, and the trade-offs. It offers 2–6 options (`opt1…`), each with the issue ids it addresses, preferring bridges or frames over deletion.

## Pipeline details

- **Image size**: images are normalized to at most 768 px on the long side and flattened onto white. Canvas coordinates are source-image pixels; physical size = `sheetWidthMm / canvas.width` mm per px.
- **Decomposition order**: layers are processed front to back. Element descriptions and style are extracted before the loop.
  - Within a layer, all detections are segmented in parallel. Overlap between elements on the same layer is resolved by **repainting the larger element's texture** under the smaller one with push-pull fill; shapes are left unchanged.
  - The hole is the union of the layer's masks dilated by 3 px.
  - The **back layer is never segmented**: the final reconstructed work image becomes a full-rectangle "background" element.
- **Mask quality checks**: confidence ≥ 0.55, IoU of mask box with detection box ≥ 0.5, mask area ≥ 12% of the box. A mask that fails is refined once. If it still fails, the redraw fallback runs. If the fallback mask covers less than 5% of the box, the best earlier attempt is kept.
- **Element representation**: a local mask PNG, a texture PNG with alpha, SVG path data (evenodd) in local pixels, and a placement (`x, y` centre, `scale`, `rotation` in degrees). `sourceBox` remembers where the element came from in the source image (used by Auto Layout and Repair).
- **Auto Layout**: elements with a source position go back to it at scale 1 and rotation 0. Elements without one (grabs) go on a 3×3 grid at about 35% of the canvas size. Draw order within a layer: background, then frame, then larger elements behind smaller ones.
- **Per-version workspaces**: "each version can be analyzed independently" became one `Workspace` per source version, holding the plan, decomposition, canvas, material and prepare state. Switching versions switches the workspace. A refined version gets an automatic layer proposal.
- **Canvas versions**: every saved change pushes the previous canvas and elements onto `canvasHistory` (max 40). Undo restores them. Plan revisions keep earlier plans, and the user can revert to them.
- **Grab**: candidates are 512×512 drawings in the project's style. The element is added to the currently active layer, centred, at about 40% of the canvas size. The isolate step always runs; for `occluded` objects it also completes the hidden parts.
- **Repair**: the crop comes from the **original source image** around `sourceBox` padded by 10 px. When there is no source box, the element texture is flattened onto white. The element's placement is kept and its centre is shifted by the change in bounding box.
- **Split**: parts must lie inside the parent mask. A pixel claimed by several parts goes to the smallest part; unclaimed pixels go to the nearest part box. The parts replace the parent at the same position in the layer order and keep its transform.

## Fabrication rules (process 10)

- **Material presets**: paper 0.3 mm / min 1.0 mm, cardstock 0.6 / 1.5, plywood 3 / 2.5, acrylic 3 / 2.0. The default is cardstock with a 200 mm sheet width and a 4 mm layer gap. Every value is editable.
- **Floating**: each layer's sheet is the union of its element shapes plus an optional border frame. Any connected component other than the largest counts as floating. The issue records the nearest pair of boundary points, which the `add_bridge` tool uses.
- **Too thin**: material removed by a morphological opening with diameter `minFeatureMm`, computed with an exact Euclidean distance transform. Thin regions smaller than 1.5·d² are ignored, and at most 12 are reported per layer. The analysis resolution is upsampled up to 3× when the minimum feature is under 4 px.
- **Geometry tools**:
  - `add_bridge`: strip width = max(1.5 × min feature, requested), extended into both pieces.
  - `add_frame`: frame width ≥ 2 × min feature.
  - `thicken_element`: dilation, with the new texture area filled by push-pull.
  - `remove_thin_parts`: opening plus removal of small specks.
  - `move_element_to_layer`, `delete_element`, `set_min_feature`.
- **Loop**: after the user picks an option or types a fix, model_4 translates it into tool calls, which run in sequence. Then the system re-checks and re-explains. "Proceed to export (anyway)" is always available. Entering the Prepare tab starts a check, and changing the material does too.

## Export (process 11)

- **SVG**: one per layer, sized in mm, with `viewBox` in canvas pixels. Group `cut` is a red (#ff0000) 0.1 mm hairline traced from the layer's union at 2× resolution. Group `engrave` is blue (#0000ff) hairline element outlines; bridges and background are excluded.
- **PNG**: one per layer, a textured render at 2× canvas resolution.
- **File names**: numbered front (`01-…`) to back. The ZIP includes a README describing material and colour conventions.
- **Export choice**: the user reviews each layer's SVG and PNG, then chooses which layers and which formats (SVG/PNG) to include.

## UI, layout, styling and interaction

- **Navigation**: a top bar with three stage tabs (1 Decompose, 2 Create, 3 Prepare). Create and Prepare unlock once a canvas exists. The app switches to Create automatically when a decomposition finishes. A status line shows the step each running job is on.
- **Decompose stage**, three columns:
  - Left: source versions as thumbnails plus "New source", and the refine text box.
  - Centre: the source image, then a decomposition progress panel with the work-image filmstrip, extracted segments per layer with recovery badges, and the step log.
  - Right: the layer plan as cards from front to back, the chat for changes, earlier-plan chips, and the confirm button.
- **Start screen**: an upload drop zone, or a prompt that generates 3 candidates shown in a grid. Includes Regenerate.
- **Create stage**:
  - Left: the layer list (rename, frame toggle, visibility, element chips, add layer), Auto Layout, Undo, and the Grab panel.
  - Centre: the SVG canvas. All layers are drawn back to front; "focus layer" dims the others. Drag the body to move; the square handle scales, the round handle rotates (Shift snaps to 15°). Delete or Backspace removes the selected element, and Cmd/Ctrl+Z undoes.
  - Right: the three.js preview, and an inspector with numeric transform fields, a layer select, forward/backward ordering, delete, repair, and the split chat.
- **3D preview**: each layer is a textured plane with alpha test. Sheet thickness is faked with darker copies stacked behind the face. Spacing is `layerGap + thickness`, and the user can orbit and zoom.
- **Prepare stage**:
  - Left: the material form and the issue list (hover highlights an issue on the canvas; click focuses its layer).
  - Centre: a read-only canvas with per-layer tabs and issue boxes. Floating issues are amber with a dashed bridge line; thin issues are red.
  - Right: the assistant chat, which shows the executed tool calls inline, the option buttons, free text, Re-check, and Proceed to export. The export panel opens under the canvas.
- **Visual style**: a warm paper palette (cream background, terracotta accent #c2562b, dark ink), system sans font, rounded panels.

## Verification performed

- `npm run typecheck`, `npm run build` and `npm test` (13 tests) pass.
- I exercised every process through the HTTP API with the real Claude CLI:
  - Process 1: 3 candidates generated, one selected.
  - Process 3: plan proposed, then revised once.
  - Processes 4 and 5: decomposition produced 11 elements on 4 layers; the refinement path ran twice.
  - Process 10: a floating fox was bridged, and a thin feature was thickened, both through the agent; each re-check came back clean.
  - Process 11: the ZIP contained 4 SVGs, 4 PNGs and a README.
  - Process 6: owl grabbed. Process 8: pine repaired. Process 9: fox split into tail and body.
  - Process 2: a refined version was created and given its own plan.
  - Second decomposition of the refined version, after adding edge snapping: 9 elements on 5 layers. The fox now includes both ears and the pine came out clean.
- **Not verified**: I had no browser, so I could not click through the React UI. It compiles, but the drag interactions and the 3D preview have not been observed running.
- **Known limitations**: polygon-based segmentation is coarser than SAM2, and images from model_2 are SVG illustrations, not photographs.

## Did the design remind me of a specific published system?

**No, not one I can name with confidence.** The combination looks like a recent HCI research prototype (CHI/UIST style):
- image → depth-ordered layers via VLM + SAM2;
- AI inpainting of occluded regions;
- a "Grab" path for extra elements;
- layered composition with a 3D preview;
- an agent that checks floating and thin parts before laser-cut export.

I don't recognize the specific paper. I did not look it up, and I won't guess a title.

Choices that came from general background knowledge rather than from the design:
- **Laser-cutting conventions**: red hairline = cut, blue = engrave, SVG sized in millimetres. These are common laser-cutter and LightBurn/Inkscape conventions.
- **Remedy vocabulary**: "bridges", border frames, and thickening as fixes for floating islands and thin features come from papercut/stencil practice and fabrication-aware design tools in general (e.g., the laser-cutting research line such as Kyub and Fabricaide). The design only says "floating components" and "material-dependent thin features".
- **Physical model of the artwork**: layers are stacked shadow-box sheets with spacers, hence the `layerGapMm` setting and the stacked-plane preview.
- **Inpainting by masked compositing** and **mask recovery by differencing against a plain background**: the design describes the latter; the compositing detail is standard practice.
- **Thin-feature test** by morphological opening, and **floating test** by connected components: standard computational-geometry approaches, not specified in the design.
