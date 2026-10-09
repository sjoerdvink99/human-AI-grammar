# Plan — System X

The design has three processes and no descriptions, representations, references, or images.
Read together, they describe a *tangible-style* generative design studio: a person lays out
spatial tokens (bands, magnets, sticks, sand) on a surface, deterministic tools clean them up
and convert them to conditioning maps, and an image model (`model_1`) renders, while a text
model (`model_2`) writes copy. The three processes share no identifiers, so they are three
modes (tabs) of one application.

Physical sensing is simulated with direct manipulation on an HTML canvas: `tool_1` plays the
role of the "sensing / clean-up" layer, `tool_2` the city simulation engine, and `tool_3`
the converter/compositor.

## Stack (repo was empty — recommended default taken)

- Vite + React + TypeScript frontend; all `tool_*` steps run as pure TS functions in the browser.
- Express (run with `tsx`) backend that owns every `model_*` step.
- One provider function `callModel()` in `server/llm.ts` shells out to
  `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed.
- Model outputs are validated with zod. Images are generated as SVG (the only image format the
  CLI can produce), sanitized server-side and displayed through `<img src="data:…">`.
- No persistence beyond in-memory React state (version history kept where steps compare).
- Vitest for unit tests of the deterministic tools.

## Representations

| identifier | type | contents | file |
| --- | --- | --- | --- |
| urban_site | `UrbanSite` | 32×32 cell site (512 px) with a river of water cells | src/urban/types.ts |
| zoning_bands (v1,v2) | `ZoningBand[]` | freehand strokes with zone type + width; v2 simplified/smoothed/clipped | src/urban/types.ts |
| urban_plan | `UrbanPlan` | 32×32 grid of zone / road / water / empty cells | src/urban/types.ts |
| city_model (v1,v2) | `CityModel` | buildings (cell, footprint, height, zone) + parks; isometric view | src/urban/types.ts |
| density_grid (v1,v2) | `DensityGrid` | 8×8 values 0..1, editable heat map | src/urban/types.ts |
| depth_map | `DepthMap` | top-down height map: PNG + 32×32 quantized levels 0–9 | src/urban/types.ts |
| render (v1,v2) | `Render` | SVG aerial image 512×512; both versions kept for comparison | src/urban/types.ts |
| function_magnets (v1,v2) | `FunctionMagnet[]` | function type + position + radius on the render | src/urban/types.ts |
| inpainting_masks | `InpaintMask[]` | circles (cx, cy, r) | src/urban/types.ts |
| function_prompts | `FunctionPrompt[]` | text prompt per mask | src/urban/types.ts |
| ikebana_canvas | `IkebanaCanvas` | 400×500 surface with vase mouth point | src/ikebana/types.ts |
| ikebana_elements (v1,v2) | `IkebanaElement[]` | branch / leaf / grass strokes, flowers (center + radius) | src/ikebana/types.ts |
| scribble_map | `ScribbleMap` | black-on-white line drawing PNG + polylines | src/ikebana/types.ts |
| ikebana_prompt | `string` | text prompt composed from elements | src/ikebana/tools.ts |
| ikebana_image | `GeneratedImage` | SVG 400×500 | src/ikebana/types.ts |
| poster_theme | `string` | theme text field | src/poster/PosterView.tsx |
| poster_canvas | `PosterCanvas` | 420×594 surface | src/poster/types.ts |
| sand_clusters (v1,v2) | `SandCluster[]` | closed polygons drawn as lassos; v2 after moving/scaling/deleting | src/poster/types.ts |
| spoken_roles | `SpokenRole[]` | per cluster: recorded audio (MediaRecorder) + transcript (Web Speech API, typed fallback) | src/poster/types.ts |
| element_roles | `ElementRole[]` | category ∈ title/subtitle/body/image/date/caption/unknown per cluster | src/poster/types.ts |
| element_specs | `ElementSpec[]` | id, role, bbox, reading order, theme, max characters | src/poster/types.ts |
| text_elements | `TextElement[]` | text per text-role spec | src/poster/types.ts |
| image_elements | `ImageElement[]` | SVG per image-role spec | src/poster/types.ts |
| poster | `string` (SVG) | composed poster, downloadable | src/poster/tools.ts |

## Transformations

| process | step | function / component | file |
| --- | --- | --- | --- |
| 1 | human specify → zoning_bands_1 | draw strokes on `SiteCanvas` | src/urban/UrbanView.tsx |
| 1 | tool_1 modify → zoning_bands_2 | `tool1CleanBands` | src/urban/tools.ts |
| 1 | tool_3 compose → urban_plan_1 | `tool3ComposePlan` | src/urban/tools.ts |
| 1 | tool_2 translate → city_model_1 | `tool2PlanToCityModel` | src/urban/tools.ts |
| 1 | tool_3 translate → density_grid_1 | `tool3CityToDensity` | src/urban/tools.ts |
| 1 | human modify → density_grid_2 | paint on `DensityEditor` | src/urban/UrbanView.tsx |
| 1 | tool_2 modify → city_model_2 | `tool2ApplyDensity` | src/urban/tools.ts |
| 1 | tool_3 translate → depth_map_1 | `tool3CityToDepthMap` | src/urban/tools.ts |
| 1 | model_1 generate~ → render_1 | `model1GenerateRender` | server/models.ts |
| 1 | human specify → function_magnets_1 | place/drag magnets on render | src/urban/UrbanView.tsx |
| 1 | tool_1 modify → function_magnets_2 | `tool1SettleMagnets` | src/urban/tools.ts |
| 1 | tool_3 translate → masks + prompts | `tool3MagnetsToMasks` | src/urban/tools.ts |
| 1 | model_1 modify~ → render_2 | `model1InpaintRender` | server/models.ts |
| 2 | human specify → ikebana_elements_1 | draw on `IkebanaView` canvas | src/ikebana/IkebanaView.tsx |
| 2 | tool_1 modify → ikebana_elements_2 | `tool1TidyElements` | src/ikebana/tools.ts |
| 2 | tool_3 translate → scribble_map + prompt | `tool3ElementsToScribble` | src/ikebana/tools.ts |
| 2 | model_1 generate~ → ikebana_image_1 | `model1GenerateIkebana` | server/models.ts |
| 3 | human specify → sand_clusters_1 | lasso drawing | src/poster/PosterView.tsx |
| 3 | human modify → sand_clusters_2 | move / scale / delete clusters | src/poster/PosterView.tsx |
| 3 | human specify → spoken_roles_1 | per-cluster mic recording | src/poster/PosterView.tsx |
| 3 | tool_3 translate → element_roles_1 | `tool3SpeechToRoles` | src/poster/tools.ts |
| 3 | tool_3 compose → element_specs_1 | `tool3ComposeSpecs` | src/poster/tools.ts |
| 3 | model_2 generate~ → text_elements_1 | `model2GeneratePosterText` | server/models.ts |
| 3 | model_1 generate~ → image_elements_1 | `model1GeneratePosterImages` | server/models.ts |
| 3 | tool_3 compose → poster_1 | `tool3ComposePoster` | src/poster/tools.ts |

## Images
The design lists none.

## Open choices (defaults taken)
- Provider: Claude Code CLI behind `callModel()`; `MODEL_1` / `MODEL_2` env vars pick models.
- Image generation: SVG via the text model (no image API available).
- Persistence: none (in-memory).
- Layout: tabbed app, each process a left-to-right stepper with the canvas center and a step panel.
- Tool steps run automatically when the preceding human step is confirmed with a button.
