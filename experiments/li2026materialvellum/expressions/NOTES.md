# Implementation notes — decisions the design did not determine

The design gives three processes as grammar expressions only. It has no goal, description, representation
descriptions, references, or images. Everything below was my choice.

## Overall interpretation
- **What the system is.** I read it as a *tangible-style* generative studio. Spatial `instruction` tokens (bands,
  magnets, ikebana elements, sand heaps) are placed by hand. `tool_1` cleans up the placed tokens, `tool_2` is a
  city-model engine, `tool_3` converts and composes, `model_1` is an image model, and `model_2` is a text model.
- **Physical input is simulated** with direct manipulation (pointer drawing and dragging) on SVG canvases. There is no
  camera or sensing hardware. `tool_1` therefore does the clean-up a sensing layer would do (simplify, snap, settle)
  and not actual detection.
- **Three processes as three tabs** of one app (City, Ikebana, Poster). They share no identifiers, so they share no
  state. All tabs stay mounted, so switching keeps your work.
- **Triggers.** A human step ends with an explicit "confirm" button. The tool and model steps after it run automatically
  until the next human step, because no human acts in between.

## Stack and infrastructure
- Vite + React 18 + TypeScript frontend. Express backend run with `tsx`. zod validates model output, fast-xml-parser
  checks SVG well-formedness, and Vitest runs the tests. No state library and no database; state lives in memory in
  React.
- Every `tool_*` step is a pure TypeScript function in the browser. Every `model_*` step is a backend endpoint.
- Provider: one function, `callModel()` in `server/llm.ts`. It spawns `claude -p --output-format json
  --no-session-persistence --tools "" --system-prompt … --json-schema …` with `CLAUDECODE` removed, sends the prompt
  on stdin, and reads `structured_output`, falling back to JSON parsed out of `result`. It times out after 300 s.
  `MODEL_1` and `MODEL_2` env vars choose a model per role. By default the CLI uses its own default model.
- **Images are SVG.** The CLI cannot produce pixels, so `model_1` writes SVG documents. They are sanitized (scripts,
  event handlers, foreignObject and external URLs are removed), checked for well-formed XML, and shown through
  `<img src="data:…">` so they cannot run code. If the output is invalid, the call is retried once automatically.
- Ports: web 5180, API 8790 (I avoided 5173 and 8787 because other projects on this machine use them).

## Process 1 (City)
- `urban_site`: a 512 px square site on a 32×32 grid, with a fixed meandering river of water cells.
- `zoning_bands`: freehand strokes, each with one of five zones (residential, commercial, office, industrial, green)
  and a width (16–160 px). The zone is chosen with chips and the width with a slider.
- `tool_1 modify` (bands): clip to the site, Ramer–Douglas–Peucker simplification, Chaikin smoothing, snap the width
  to whole cells, and drop strokes shorter than one cell.
- `tool_3 compose` → `urban_plan`: rasterize the bands onto the grid (later bands win and water is never overwritten),
  then add a road every 6th row and column through developed land.
- `tool_2 translate` → `city_model`: one box per built cell. Height comes from a per-zone base (residential 14 m,
  commercial 32 m, office 60 m, industrial 12 m) times deterministic noise. Green cells become parks. The model is shown
  as an isometric canvas view.
- `density_grid`: 8×8 blocks with values 0–1, computed as the mean built height per block normalized by 60 m. It is
  edited with a ＋/− brush in steps of 0.1 and shown as a heat overlay with numbers. While you paint, a live preview
  of `city_model_2` appears beside it.
- `tool_2 modify`: scales the buildings in each block so its density matches the painted value. A block painted from
  zero gets residential infill, and a block painted to zero is cleared.
- `depth_map`: a top-down height map (taller is brighter), shown as a PNG. For the model it is quantized to a 32×32
  grid of digits 0–9, because the CLI receives text.
- `model_1 generate` prompt: a ControlNet-style "depth-conditioned" aerial rendering at golden hour, top-down, with
  roofs matching the non-zero cells. The style is fixed in the model configuration because the state carries no style
  instruction.
- `function_magnets`: 8 functions (park, plaza, school, hospital, market, stadium, museum, waterfront) with emoji
  icons. Click to drop a magnet, drag to move it, double-click to remove it.
- `tool_1 modify` (magnets): give each function a fixed radius (36–60 px), push overlapping magnets apart, and keep
  them inside the image.
- `tool_3 translate`: each magnet becomes a circular mask plus a fixed descriptive prompt per function type.
- `model_1 modify` (inpainting): the model gets the current SVG, the masks and the prompts, and returns one SVG patch
  per mask. The server composites the patches over the unchanged `render_1`, each clipped to its circle, so pixels
  outside the masks cannot change. A malformed patch is dropped; if none are usable, the call retries.
- Versions: every `render_1` generated is kept as a thumbnail and can be picked again. `render_2` is compared with
  `render_1` side by side, before, or after, with the masks outlined.

## Process 2 (Ikebana)
- `ikebana_canvas`: 400×500 px with a fixed vase; its mouth is the anchor point.
- `ikebana_elements`: branch, leaf and grass strokes, and flowers (drag from the centre to set the radius).
- `tool_1 modify`: smooth strokes; orient stems from the vase outward; snap stem bases that start within 80 px of the
  mouth into the mouth, fanned out; attach leaves to the nearest stem point; snap flowers within 45 px onto stem tips;
  clamp flower size.
- `tool_3 translate`: the scribble map is black lines on white, including the vase outline, with flowers as circles and
  leaves as almond outlines. It is shown as a PNG and sent to the model as polylines. `ikebana_prompt` is a template
  filled with element counts, stem height and lean, and large blooms, plus a fixed style tail ("asymmetrical, negative
  space, soft daylight…").
- `model_1 generate`: ControlNet-scribble-style SVG painting. "Generate another variant" keeps earlier variants in a
  gallery.

## Process 3 (Poster)
- `poster_theme`: a free text field. `poster_canvas`: 420×594 px (A-series ratio).
- `sand_clusters`: closed lasso outlines rendered with a sand texture. `human modify` means drag to move, a corner
  handle to scale, and double-click to sweep a heap away. "Reset shapes" restores `sand_clusters_1`.
- `spoken_roles`: a microphone button per heap records audio (MediaRecorder) and transcribes it with the browser's
  Web Speech API. There is a typed fallback when no microphone or speech recognition is available, and the audio can
  be played back.
- `tool_3 translate` → `element_roles`: keyword rules on the transcript map it to {title, subtitle, body, date, caption,
  image}, or `unknown`. Unknown heaps are left out, with a warning.
- `tool_3 compose` → `element_specs`: role, bounding box, reading order (top-to-bottom, then left-to-right), the theme,
  and `maxChars` estimated from the box area per role. The theme is copied into each spec because the later
  `model_1` state no longer contains `poster_theme_1`.
- `model_2` prompt: a concise copywriter with roles and character limits. The limits are enforced again in code by
  truncating at a word boundary.
- `model_1` (poster images): one call that returns an SVG per image heap, sized to its box. The prompt uses only the
  specs and the written text.
- `tool_3 compose` → poster: the palette is chosen deterministically from a hash of the theme. Text is wrapped and
  fitted to the largest font size that fits the heap's box (serif uppercase titles, sans body). Images are clipped to
  the heap's sand outline. You can download SVG or PNG (3×), and earlier posters stay as thumbnails.

## UI and styling
- Each mode is a two-column layout: the working stage on the left and a **pipeline** column on the right. The pipeline
  lists every representation (`id`, role · medium) and every transformation (`[actor op]~`, coloured by actor type)
  and fills in with thumbnails and values as the process runs.
- Neutral warm-grey palette, system font, rounded panels, and a spinner with elapsed seconds during model calls.

## Verification done
- `npm run build` (tsc + vite) is clean, and `npm test` passes 7 tests covering every tool and the SVG validation.
- I drove all three processes end to end in headless Chromium (Playwright) against the real CLI. Every transformation
  was reached and every model step returned valid output: render about 2 min, inpaint about 1 min, ikebana about
  30 s, poster text about 4 s, poster images about 45–100 s.
- Not tested: real microphone and speech recognition, since the headless run used the typed fallback.

## Did the design remind me of a published system?
The design did not point me to one specific paper I can name with confidence. Its parts strongly reminded me of known
work, and several choices came from that knowledge rather than from the expressions:

- **MIT Media Lab CityScope / tangible urban-planning tables** (LEGO-grid city models with live simulation feedback).
  From this I took: modelling the site as a cell grid, a procedural "city engine" for `tool_2`, density as an
  editable per-block heat map, and the isometric 3D preview.
- **ControlNet** (depth, scribble and inpainting conditioning for diffusion models). From this I took: reading
  `depth_map → [model_1 generate]` as depth-conditioned rendering, `scribble_map` as a black-on-white scribble
  condition, `inpainting_masks + function_prompts → [model_1 modify]` as per-mask inpainting, and wording all of
  `model_1`'s prompts as conditioned image generation.
- **AR sandboxes and tangible "sand table" interfaces.** These shaped my reading of `sand_clusters` as heaps you pour
  and push around, and of `tool_1` as the clean-up layer of a sensing system for physical tokens.
- The combination of urban planning, ikebana and posters on one tangible surface with voice suggests a research
  system about tangible interfaces for generative AI. I don't know which one, and I did not look it up.
