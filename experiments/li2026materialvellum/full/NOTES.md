# NOTES — decisions the design did not determine

The design fixes the steps, actors, and representation contents. Everything below is my own choice.

## Stack and libraries
- **Frontend:** Vite + React 19 + TypeScript, with no state library (React state per probe). **Backend:** Express 5 run with `tsx`. **Tests:** Vitest. **E2E:** Playwright script (`scripts/e2e.mjs`).
- **tool_1 "physics engine":** a small hand-written position-based solver (`src/tools/physics.ts`) instead of Matter.js or Box2D. Bands, magnets, and the ikebana rules are constraint and spring problems, not rigid-body ones.
- **tool_2 "3D rendering library":** three.js with OrbitControls.
- **Speech:** the browser Web Speech API (`webkitSpeechRecognition`), with a typed fallback. No audio is stored; the transcript is the trace of `spoken_roles`.
- **Model provider:** the Claude Code CLI via `callModel()` (`server/model.ts`): `claude -p --output-format json --tools "" --no-session-persistence --system-prompt …`, with the prompt on stdin, `CLAUDECODE` unset, and `--json-schema` where output is structured. `MODEL_1`/`MODEL_2` env vars select per-role models. The default is the CLI's default model.

## Substituting the image model (largest deviation)
- The design's model_1 is a diffusion model with ControlNet Depth/Scribble and LayerDiffuse. Only a text model was available, so **model_1 emits SVG**:
  - **Depth conditioning:** the depth image is rendered for real (three.js shader, top-down orthographic, brightness = height), shown to the user, and sent to the model as a **24×24 grid of digits 0–9**.
  - **Scribble conditioning:** a real black/white scribble image is shown. The model receives the same strokes as **polylines and circles in pixel coordinates**.
  - **Inpainting:** the model receives the render_1 SVG (truncated at 40 k chars), each mask rectangle, and its function prompt. It returns one `<g>` patch per mask as JSON. The app clips each patch to its mask and draws it over render_1 to get render_2.
  - **Transparency (LayerDiffuse):** prompts ask for no background, and `stripBackground()` removes a full-canvas background rect if one appears anyway.
- **Output validation:** the SVG is extracted from the text, then `<script>`, `<foreignObject>`, `on*` handlers, and external hrefs are stripped. A viewBox is added if missing. Images are displayed via `<img src=data:…>`, so they are sandboxed.

## Data formats
- **Site:** 600×600 units with a fixed 12×12 block grid (50-unit cells, 8-unit streets). The design says only "an empty site".
- **Zones:** the fixed set residential / commercial / mixed / industrial / park, chosen with chips before drawing a band.
- **Bands:** freehand loops resampled to 40 points. Later bands override earlier ones in the plan.
- **urban_plan:** a zone per block, decided by a point-in-polygon test at the block centre.
- **city templates:** residential has 4 houses per block, commercial 1 tower, mixed a podium plus tower, industrial a shed plus chimney, park cone trees. Height = clay density × 160.
- **density_grid:** 24×24 (2×2 cells per block), seeded by zone (commercial .75, mixed .5, residential .3, industrial .25, park 0).
- **Functions:** park, school, hospital, market, plaza, library, sports, each with emoji icons. The **compatibility table** is mine, e.g. school↔park attract, hospital↔sports repel, and identical functions repel.
- **Inpainting masks:** each magnet takes the nearest block not already taken by another magnet, so each mask is one block.
- **Function prompts:** one fixed descriptive sentence per function.
- **Ikebana rules:** the moribana-style shin / soe / hikae have length ratio 1 : ¾ : 9⁄16. Angle ranges are shin 0–25°, soe 35–60°, and hikae 60–85° on the side opposite soe. Dragging any main stem rescales all three. Flowers and leaves stay within ±22° of the nearest main stem, shorter than 85 % of it, and push each other apart.
- **Sand:** a 64×64 density grid. Pour adds, Push moves sand along the drag, and Brush away removes. Clusters are 8-connected components above 0.08 density with at least 6 cells. Cluster ids stay stable across reshaping by matching on maximum cell overlap.
- **Cluster metrics:** size = bbox area / canvas area; density = mean grain density, which becomes the visual weight.
- **Roles:** the fixed set title / subtitle / body / image / decoration, mapped from the transcript by keyword regexes. Unrecognised speech is shown with a warning, and unlabeled clusters are left out of the poster.
- **element_spec:** `{clusterId, role, x, y, w, h, size, weight, request}`. The request is a template sentence that includes the theme.
- **Poster layout:** cream background. Layers go decoration → image → body → subtitle → title. Text is fitted to the cluster bbox by greedy wrapping and the largest size that fits. Font weight is 300–900 from density. Image opacity is 0.55–1 from density. Text word limits scale with cluster size.

## Model prompts
- Two system prompts: model_1 is "an image generator that outputs a single standalone SVG … follows spatial conditioning exactly (like a ControlNet)"; model_2 is "a poster copywriter … answer only in JSON".
- One user prompt per operation, in `server/routes.ts`: urban render (aerial golden-hour illustration; brightness and shadows from height), inpaint (JSON patches), ikebana (botanical painting following the scribble), poster text (JSON, word limits per role), and poster image (one call per image or decoration element, run in parallel, transparent, no text).
- For model_1 poster images, the prompt is built from element_specs + text_elements only, as the design's state prescribes. The theme reaches it through each spec's `request`.

## Layout and interaction
- Three tabs share one app shell. Each probe has a left step panel, a central interactive surface, and a right "pipeline state" panel that shows the intermediate representations (depth map, masks and prompts, scribble map, prompt, specs table, texts, images).
- **Urban:** a 3-step stepper (Zoning → Density clay → Function magnets) with back buttons. The density stage shows the three.js view beside a 2D clay map; Shift reverses the brush. A live block-colour preview of the plan appears while drawing bands. Compatible magnets are joined by green lines and repelling ones by red dashed lines. Magnet physics runs on every animation frame. Magnets are dropped by tapping with a function chip selected.
- **Ikebana:** dashed proportion-guide circles. Removing elements and resetting are allowed (except for the three main stems).
- **Poster:** in label mode, tapping a cluster starts speech recognition. Clusters are outlined and annotated with id, role, size %, and density %.
- **Multi-touch:** Pointer Events, tracked per `pointerId`, so several fingers can hold band vertices, sculpt, or drag magnets and circles at the same time.
- **`~` handling:** spinner with phase text, error box, Regenerate / Generate again, and a version strip for renders, ikebana images, and posters. Inpainting always uses the selected version as render_1.
- **Persistence:** none (in-memory). Poster PNG export is rasterised client-side.

## Did the design remind me of a specific published system?
Partly. The description (digital *elastic bands, clay, magnets, sand* as material metaphors feeding constraints to ControlNet/LayerDiffuse, with urban/ikebana/poster probes) reads like a recent CHI/UIST-style research-through-design paper on "material" or "tangible-feeling" interactions for generative AI. I cannot name it with confidence, and I did not look it up. The urban probe also brought to mind tangible urban-planning tables such as MIT's CityScope (zoning, density, and function tokens). I did not copy anything specific from it.

Choices that came from my background knowledge rather than from the design:
- **Ikebana rules:** the shin / soe / hikae names, the ~1 : ¾ : ¾² length ratios, and the typical angle ranges come from general knowledge of ikebana (moribana basics). The design only says "proportional rules".
- **Urban compatibility pairs:** schools near parks, hospitals away from sports grounds and markets, markets with plazas. These are common planning heuristics I chose; the design names only "park or school".
- **Depth map:** treating it as brightness = height, top-down, follows how ControlNet depth maps are usually conditioned (near = bright).
- **Transparency:** "transparent background" as the stand-in for LayerDiffuse reflects what LayerDiffuse does.
No other choice depended on knowing the original system.
