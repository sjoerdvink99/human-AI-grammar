# System X — tangible generative studio

A web implementation of the Human-AI grammar design in `design.json`. It has three modes, one per process:

| Mode | What you do |
| --- | --- |
| **City** | lay zoning bands on a river site → a procedural 3D city appears → paint its density → model_1 renders it from a depth map → drop function magnets on the render → model_1 inpaints those functions |
| **Ikebana** | draw branches, leaves, grass and flowers into a vase → the elements are tidied → a scribble map and prompt are derived → model_1 generates the arrangement |
| **Poster** | type a theme, pour heaps of "sand" where elements go, push them around, say what each heap is → model_2 writes the copy, model_1 draws the images → the poster is composed |

## Run

```bash
npm install
npm run dev        # API on :8790 (PORT to change), web UI on http://localhost:5180
npm test           # unit tests for all deterministic tools and SVG validation
npm run build      # type check + production build
```

Model steps call the local Claude Code CLI (`claude -p --output-format json --json-schema … --tools ""`, with
`CLAUDECODE` removed from the environment). The provider lives in one function, `callModel` in `server/llm.ts`.
Set `MODEL_1` / `MODEL_2` to choose a model per role (e.g. `MODEL_1=sonnet`) and `CLAUDE_BIN` to change the binary.
Image steps take roughly 25 s to 2 min each because the CLI writes the images as SVG.

## Design → code

Representations keep their design names (without the version suffix in types, with it in state variables).
The right-hand **pipeline** column in each mode lists every representation and transformation of the process and
fills in as it runs.

### Process 1 (City) — `src/urban/`

| Transformation | Implementation |
| --- | --- |
| `urban_site_1 → [human specify] → zoning_bands_1*` | `BandCanvas` stroke drawing, `UrbanView.tsx` |
| `[tool_1 modify] → zoning_bands_2*` | `tool1CleanBands`, `tools.ts` |
| `[tool_3 compose] → urban_plan_1` | `tool3ComposePlan`, `tools.ts` |
| `[tool_2 translate] → city_model_1` | `tool2PlanToCityModel`, `tools.ts` (isometric view: `IsoCity`) |
| `[tool_3 translate] → density_grid_1` | `tool3CityToDensity`, `tools.ts` |
| `[human modify] → density_grid_2` | `DensityEditor` brush, `UrbanView.tsx` |
| `[tool_2 modify] → city_model_2` | `tool2ApplyDensity`, `tools.ts` |
| `[tool_3 translate] → depth_map_1` | `tool3CityToDepthMap`, `tools.ts` |
| `[model_1 generate]~ → render_1` | `model1GenerateRender`, `server/models.ts` |
| `[human specify] → function_magnets_1*` | `MagnetBoard`, `UrbanView.tsx` |
| `[tool_1 modify] → function_magnets_2*` | `tool1SettleMagnets`, `tools.ts` |
| `[tool_3 translate] → inpainting_masks_1* + function_prompts_1*` | `tool3MagnetsToMasks`, `tools.ts` |
| `[model_1 modify]~ → render_2` | `model1InpaintRender`, `server/models.ts` |

### Process 2 (Ikebana) — `src/ikebana/`

| Transformation | Implementation |
| --- | --- |
| `ikebana_canvas_1 → [human specify] → ikebana_elements_1*` | `ElementCanvas`, `IkebanaView.tsx` |
| `[tool_1 modify] → ikebana_elements_2*` | `tool1TidyElements`, `tools.ts` |
| `[tool_3 translate] → scribble_map_1 + ikebana_prompt_1` | `tool3ElementsToScribble`, `tools.ts` |
| `[model_1 generate]~ → ikebana_image_1` | `model1GenerateIkebana`, `server/models.ts` |

### Process 3 (Poster) — `src/poster/`

| Transformation | Implementation |
| --- | --- |
| `poster_theme_1 + poster_canvas_1 → [human specify] → sand_clusters_1*` | lasso pouring in `SandBox`, `PosterView.tsx` |
| `[human modify] → sand_clusters_2*` | move / resize / sweep in `SandBox`, `PosterView.tsx` |
| `[human specify] → spoken_roles_1*` | `SpeakRow` (MediaRecorder + Web Speech API, typed fallback), `PosterView.tsx` |
| `[tool_3 translate] → element_roles_1*` | `tool3SpeechToRoles`, `tools.ts` |
| `[tool_3 compose] → element_specs_1*` | `tool3ComposeSpecs`, `tools.ts` |
| `[model_2 generate]~ → text_elements_1*` | `model2GeneratePosterText`, `server/models.ts` |
| `[model_1 generate]~ → image_elements_1*` | `model1GeneratePosterImages`, `server/models.ts` |
| `[tool_3 compose] → poster_1` | `tool3ComposePoster`, `tools.ts` |

Generated output (`~`) handling: loading indicator with elapsed time, retry on error, regenerate buttons, earlier
renders/variants/posters kept as thumbnails, zod validation of every model reply, SVG sanitizing and XML
well-formedness checks with one automatic retry (`server/svg.ts`, `withSvgRetry`), and character limits enforced
on model_2's text.
