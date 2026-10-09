# System X — material-gesture design probes

A multi-touch web app that turns gestures on digital **elastic bands**, **clay**, **magnets**, and **sand** into constraints for AI-generated visual designs. It has three probes, shown as tabs: urban neighborhood, ikebana, and graphic poster. It is built from `design.json` (Human-AI grammar design).

## Run

```bash
npm install
npm run dev        # Vite on :5173 + API server on :8787 (open http://localhost:5173)
npm test           # unit tests for the deterministic tools
npm run build      # type-check + production bundle; then `npm start` serves dist/ on :8787
```

Model steps call the local **Claude Code CLI** (`claude -p --output-format json`, with `CLAUDECODE` removed from the environment). The only provider boundary is `callModel()` in `server/model.ts`. Set `MODEL_1` / `MODEL_2` to choose a model per role. Each model call takes about 5–60 s.

`node scripts/e2e.mjs` (with `npm run dev` running; `CHROME=<path>` optional, `ONLY=urban,ikebana,poster`) drives all three processes in a headless browser and saves screenshots to `screenshots/`.

## Design → code

Actors: **model_1** is the image model. The design calls for a diffusion model with ControlNet Depth/Scribble and LayerDiffuse; here Claude emits SVG under the same conditioning. **model_2** is the language model. **tool_1** is the physics solver (`src/tools/physics.ts`), **tool_2** is three.js (`src/tools/city3d.ts`), and **tool_3** is the pre/post-processing (`src/tools/*.ts`).

### Process 1 — Urban neighborhood (`src/urban/UrbanProbe.tsx`)
| Step | Code |
|---|---|
| urban_site_1 → [human specify] → zoning_bands_1 | `zoningDown/Move/Up`: draw closed loops; zone chips |
| [tool_1 modify] → zoning_bands_2 | `relaxBands()` (springs, smoothing, bounds, non-overlap; vertices can be grabbed, with multi-touch) |
| [tool_3 compose] → urban_plan_1 | `composePlan()` in `src/tools/urbanPre.ts` |
| [tool_2 translate] → city_model_1 | `buildCity()` + `CityView` in `src/tools/city3d.ts` |
| [tool_3 translate] → density_grid_1 | `initDensity()` |
| [human modify] → density_grid_2 | clay brush `sculpt()` (raise / lower / smooth) on the density map |
| [tool_2 modify] → city_model_2 | `updateCityHeights()` (live) |
| [tool_3 translate] → depth_map_1 | `renderDepthMap()` (orthographic top-down depth, then a 24×24 grid) |
| [model_1 generate]~ → render_1 | `POST /api/urban/render` in `server/routes.ts` |
| [human specify] → function_magnets_1 | tap the render with a function chip selected; drag magnets |
| [tool_1 modify] → function_magnets_2 | `stepMagnets()` runs continuously (compatibility table) |
| [tool_3 translate] → inpainting_masks_1 + function_prompts_1 | `magnetsToMasks()` |
| [model_1 modify]~ → render_2 | `POST /api/urban/inpaint`, then `compositeInpaint()` (patches clipped to masks) |

### Process 2 — Ikebana (`src/ikebana/IkebanaProbe.tsx`)
| Step | Code |
|---|---|
| ikebana_canvas_1 → [human specify] → ikebana_elements_1 | drag circles, + Flower / + Leaf |
| [tool_1 modify] → ikebana_elements_2 | `enforceIkebana()` (1 : ¾ : 9⁄16, angle ranges, attraction to stems, repulsion) |
| [tool_3 translate] → scribble_map_1 + ikebana_prompt_1 | `toScribble()`, `toIkebanaPrompt()` in `src/tools/ikebanaPre.ts` |
| [model_1 generate]~ → ikebana_image_1 | `POST /api/ikebana/generate` |

### Process 3 — Graphic poster (`src/poster/PosterProbe.tsx`)
| Step | Code |
|---|---|
| poster_theme_1 + poster_canvas_1 → [human specify] → sand_clusters_1 | Pour sand (`brushSand('pour')`), `detectClusters()` in `src/tools/sand.ts` |
| [human modify] → sand_clusters_2 | Push / Brush away |
| [human specify] → spoken_roles_1 | Label by voice (Web Speech API; typed fallback) |
| [tool_3 translate] → element_roles_1 | `transcriptToRole()` in `src/tools/posterPre.ts` |
| [tool_3 compose] → element_specs_1 | `composeSpecs()` |
| [model_2 generate]~ → text_elements_1 | `POST /api/poster/text` |
| [model_1 generate]~ → image_elements_1 | `POST /api/poster/images` (transparent SVG; background rect stripped) |
| [tool_3 compose] → poster_1 | `composePoster()` in `src/tools/posterCompose.ts`; Download PNG |

Generative steps (`~`) show a loading state, can be regenerated, are validated and sanitised server-side (`server/svg.ts`, JSON schemas), and keep earlier versions in a version strip.
