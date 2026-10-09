# PLAN — System X (material-gesture design probes)

Design: `design.json` (3 processes, no references, no images). The plan was accepted using my own recommended defaults, as the experiment instructions require.

## Stack (empty repo → minimal stack)
- Frontend: Vite + React + TypeScript (`src/`). All three probes are tabs ("modes") of one app.
- Backend: Node + Express in TypeScript, run with `tsx` (`server/`). It only hosts model calls.
- Model provider: one function `callModel()` in `server/model.ts` that runs `claude -p --output-format json` with `CLAUDECODE` removed from the environment. Swap the provider there.
- tool_1 physics engine: a small deterministic force/spring solver of my own (`src/tools/physics.ts`).
- tool_2 3D rendering library: three.js (`src/tools/city3d.ts`).
- tool_3 pre/post-processing: plain TS modules (`src/tools/*.ts`).
- Input: Pointer Events (multi-touch works; a mouse works too). Voice: Web Speech API with a typed fallback.

### Model roles (the design names a diffusion model; none is available)
- **model_1** (meant to be a diffusion model with ControlNet Depth/Scribble + LayerDiffuse): emulated by Claude producing **SVG images**. Conditioning is passed as text: the depth map as a downsampled numeric grid, the scribble map as polylines and circles. For transparency, the SVGs have no background. For inpainting, model_1 returns an SVG patch per mask, which is clipped to the mask and drawn over render_1.
- **model_2** (language model): Claude producing poster text as JSON.

## Representations
| id | type | contents | file |
|---|---|---|---|
| urban_site | `UrbanSite` {w,h,blocks grid, river} | empty site, fixed 12×12 block grid with streets | src/urban/types.ts |
| zoning_bands | `ZoningBand[]` {id, zone, points[]} | closed elastic polygons, one zone type each | src/urban/types.ts |
| urban_plan | `UrbanPlan` {blocks: {i,j,zone}[]} | zone per block | src/urban/types.ts |
| city_model | three.js scene + `CityModel` {buildings[]} | template buildings per block | src/tools/city3d.ts |
| density_grid | `number[][]` (12×12, 0–1) | clay-like density | src/urban/types.ts |
| depth_map | PNG dataURL + numeric grid | top-down orthographic depth of the city | src/tools/city3d.ts |
| render | SVG string (versions kept) | generated neighborhood image | src/urban/UrbanProbe.tsx |
| function_magnets | `Magnet[]` {id, fn, x, y} | park/school/hospital/market/plaza/office | src/urban/types.ts |
| inpainting_masks | `Mask[]` {magnetId, block rect} | nearest block per magnet | src/tools/urbanPre.ts |
| function_prompts | `string[]` | text per function | src/tools/urbanPre.ts |
| ikebana_canvas | `{w,h,vase}` | canvas with a vase | src/ikebana/types.ts |
| ikebana_elements | `IkebanaElement[]` {id, kind: shin/soe/hikae/flower/leaf, x,y,r} | magnetic circles | src/ikebana/types.ts |
| scribble_map | SVG line drawing + polyline data | stems, heads, leaves | src/tools/ikebanaPre.ts |
| ikebana_prompt | string | text description | src/tools/ikebanaPre.ts |
| ikebana_image | SVG string | generated arrangement | src/ikebana/IkebanaProbe.tsx |
| poster_theme | string | user-entered theme | src/poster/PosterProbe.tsx |
| poster_canvas | 512×512 square | canvas | src/poster/types.ts |
| sand_clusters | `SandGrid` (cells) → `Cluster[]` {id, cells, bbox, size, density, centroid} | sand painted by the user | src/tools/sand.ts |
| spoken_roles | `{clusterId, transcript}[]` | speech (or typed fallback) | src/poster/PosterProbe.tsx |
| element_roles | `Role` ∈ {title, subtitle, body, image, decoration} per cluster | categorical | src/tools/posterPre.ts |
| element_specs | `ElementSpec[]` {clusterId, role, x,y,w,h, weight, request} | | src/tools/posterPre.ts |
| text_elements | `{clusterId, text}[]` | model_2 output | server/routes.ts |
| image_elements | `{clusterId, svg}[]` transparent SVG | model_1 output | server/routes.ts |
| poster | composed SVG (+PNG download) | | src/tools/posterCompose.ts |

## Transformations
| process | actor op | implementation |
|---|---|---|
| 1 | human specify → zoning_bands | draw freehand loops on the site (`UrbanProbe` band tool) |
| 1 | tool_1 modify | `relaxBands()` elastic smoothing, keep inside bounds, push overlapping bands apart; runs while dragging band points |
| 1 | tool_3 compose | `composePlan()` point-in-polygon per block |
| 1 | tool_2 translate | `buildCity()` three.js templates |
| 1 | tool_3 translate | `initDensity()` zone defaults |
| 1 | human modify | clay brush on the density grid (raise / lower / smooth) |
| 1 | tool_2 modify | `updateCityHeights()` |
| 1 | tool_3 translate | `renderDepthMap()` orthographic depth → PNG + grid |
| 1 | model_1 generate~ | POST `/api/urban/render` → `renderFromDepth()` |
| 1 | human specify | place function magnets on the render |
| 1 | tool_1 modify | `stepMagnets()` attraction/repulsion by compatibility table, bounded |
| 1 | tool_3 translate | `magnetsToMasks()` nearest block + prompt |
| 1 | model_1 modify~ | POST `/api/urban/inpaint` → SVG patch per mask, clipped and composited |
| 2 | human specify | drag magnetic circles; add flower/leaf |
| 2 | tool_1 modify | `enforceIkebana()` shin:soe:hikae length ratio 1 : 0.75 : 0.56, angle ranges, repulsion |
| 2 | tool_3 translate | `toScribble()` + `toIkebanaPrompt()` |
| 2 | model_1 generate~ | POST `/api/ikebana/generate` |
| 3 | human specify | add sand (brush) |
| 3 | human modify | reshape sand (brush/erase/smudge) |
| 3 | human specify | select cluster, speak (or type) a role |
| 3 | tool_3 translate | `transcriptToRole()` keyword matching |
| 3 | tool_3 compose | `composeSpecs()` cluster bbox/size/density → spec |
| 3 | model_2 generate~ | POST `/api/poster/text` |
| 3 | model_1 generate~ | POST `/api/poster/images` |
| 3 | tool_3 compose | `composePoster()` |

## Generative handling (`~`)
Loading indicators, a Regenerate button, SVG sanitising and validation (must parse, no scripts), and earlier render versions are kept in a version strip.

## Open choices (defaults taken)
- Provider: Claude Code CLI. Persistence: none (in-memory). Images: SVG. Layout: left tool panel, central canvas, right result panel.
