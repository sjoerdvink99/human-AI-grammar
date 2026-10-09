# NOTES — decisions the design did not determine

The design gives eleven process expressions and nothing else: no goal, no descriptions, no representation
notes, no references, no images. Everything below is my choice.

## Overall interpretation
- **What the system is for.** I read the identifiers (`layer_plan`, `segments`, `canvas`, `material_settings`,
  `constraint_issues`, `layer_svgs`, `export_zip`) as a tool that turns an illustration into a **physical
  layered cut artwork** (papercut / laser-cut "shadow box"). Each depth layer is one sheet, and each segment is a cuttable piece.
- **Process 4's loop** ends back at the state after `tool_1 modify`. I read it as *peeling*: handle the
  front-most layer, remove its items from the work image and fill the area behind them, then repeat with
  the next layer. It stops after the back-most confirmed layer. On the back layer it adds a full-frame
  backboard, unless an item already covers more than 90% of the frame; that item then becomes the backboard.
- **Process 5** has no trigger in the design. I run it inside P4 for every batch of masks. The refine and
  fallback steps run only for masks that fail the quality check.
- **Process 6** ends at `grab_element` with no connection onward. Grabbed pieces go to a tray, and the user
  places them on a layer. That placement is a P7 `human modify`.
- **Process 7's loop** (`canvas_2` → back to `canvas_1`): every edit commits a new canvas version. Earlier versions are kept for undo.
- **Process 10's loop:** after `tool_3 execute`, the app re-runs evaluate + report automatically.
- **Process 7 starts automatically** (tool_2 compose) when P4 finishes, because it continues from `segments_1`.
- Selecting a new P1 candidate after work has started resets the later state, after a confirm dialog.

## Model steps (no API key → Claude Code CLI)
- One function, `callModel(role, {op, prompt, schema, images})` in `server/model.ts`. It spawns
  `claude -p --output-format json --json-schema <schema from zod> --system-prompt <role prompt> --tools ""`
  with `CLAUDECODE` deleted from the environment, reads `structured_output`, validates it with zod, and
  retries once with the validation error appended.
- Images go to the model as PNG files in a temp directory, with `--tools Read --allowedTools Read`, and the
  prompt asks it to read them first.
- Separate configurations per role (system prompt + model alias): model_1 sonnet, model_2 sonnet,
  model_3 sonnet, model_4 haiku. You can override each with `MODEL_1..4`.
- **model_2 as an "image generator".** Claude can't produce pixels, so model_2 writes **SVG**. It is told
  to draw flat shapes with ids, at 512×512, with at most ~80 shapes. Tools sanitize the SVG (no script,
  foreignObject, image, text, filter, mask, or external href), normalize it into a 512 viewBox, assign
  missing ids, and rasterize it with resvg. "Inpainting" (P4 fill) means the model edits the SVG, and the
  removal of the detected shape ids is then **enforced in code** (`removeIds`).
- **model_3 as a "segmenter".** It gets the PNG plus the SVG source and returns the shape ids per prompt
  (and/or polygons). The tool rasterizes those shapes into a mask. For P9 (split), it returns polygons only
  over a silhouette crop. The polygons are intersected with the piece, and leftover pixels go to the
  nearest part (`assignRemainder`), so the parts always cover the piece exactly.
- Three candidates in P1 and P6, generated in parallel with different style hints.
- All prompts are in `server/ops.ts`, one function per operation. Each is built only from the representations in the preceding state.

## Data formats
- Images: `{id, svg, png (data URL), note}` at 512×512.
- Masks: 512×512 binary, stored bbox-cropped as base64 bytes on the server only. They are removed before
  state is sent to the client.
- Segments: bbox, mask, traced SVG path (own pixel-edge tracer + Douglas–Peucker, even-odd fill), colour,
  layerId, offset `dx/dy`, area, source (`detected | refined | fallback | background | grab | repaired | split`).
- Segment colour comes from the SVG fill of the largest selected shape, falling back to the mean pixel colour under the mask.
- Layer plan: `{layers:[{id,name,description,depth,elements[]}], rationale, change?}`. Depth 0 is the back.
- Material settings: material, thickness, artwork width, sheet width/height, min feature width, min part
  area, max layers. Default: cardstock 1.5 mm, 200 mm wide, 300×300 sheet, 1.5 mm min feature, 6 mm² min part, 6 layers.
- Physical scale: mm per pixel = artwork width / 512.
- Mask quality (P5) rules: the mask must not be empty, not smaller than 0.05% of the image, and not larger
  than 92% of it (except on the back layer). It also fails if it is split into more than 12 pieces with the largest under 30%.
- Constraint checks (tool_3):
  - sheet overflow
  - too many layers
  - out of frame
  - piece smaller than min area
  - loose fragments smaller than min area
  - thin features (what a morphological opening at half the min width removes, if more than 12 px and 1% of the piece)
  - unsupported pieces (less than 50% overlap with the layers behind)

  Each issue type comes with fixed resolution options. Issue ids are stable: type + piece id.
- Fix tools: thicken, removeThinParts, removeSmallFragments, deleteSegment, moveToLayer, mergeLayers,
  clipToFrame, scaleSegment. A fix_call is validated against the tool registry with zod and against the
  ids on the current canvas. The tool always matches the user's chosen option.
- Export: per layer, an SVG sized in mm (red 0.1 mm hairline = cut, blue rectangle = frame) and a
  1024 px PNG with transparent background. The zip holds `svg/`, `png/` and `manifest.json` (settings, stacking order).
  Format choice: SVG, PNG or both.
- Long model chains run as server jobs. The client polls every 0.9 s and shows a step trace labelled with the grammar steps.

## UI / layout / styling
- A single page with six tabs that follow the flow: Image (P1–P2), Layer plan (P3 + P4 select),
  Decomposition (P4/P5 results), Canvas (P7 + P8, P9, P6), Fabricate (P10), Export (P11). A process-trace panel is always visible on the right.
- Canvas tab: a layer list with visibility, reorder, rename and add; an SVG editor where you drag pieces to
  move them and click to select; an inspector with layer, colour, size ±, reset, delete, Repair and Split;
  a preview toggling between a flat "front" shadow-box render (drop shadows) and an "exploded" CSS-3D stack;
  and the grab panel underneath.
- Decomposition tab: for each layer round, the work image before, the cut segments, the work image after
  removal + fill, a mask-quality table (with a fallback badge), and the fill prompt.
- Fabricate tab: material form, issue cards (radio options + Apply), the advisor report, and the canvas
  with the hovered issue's piece highlighted.
- Warm neutral palette with one orange accent; system font. No UI library.
- Placed grabs are scaled to ~28% of the canvas, centred where they were drawn.
- A plan revision is a "Revise again" text box. Earlier plan versions can be viewed from a dropdown (the build uses the latest).

## Libraries
React 19 + Vite + TypeScript, Express 5, tsx, zod 4 (schemas → JSON Schema for `--json-schema`),
@resvg/resvg-js (rasterizing), @xmldom/xmldom (SVG DOM), jszip, vitest. Playwright is a dev dependency
and was used only for a headless UI smoke test. Default port 18923 (8787/8791 were taken by other local processes).

## Verification done
- `npm run typecheck`, `npm run build`, `npm test` (10 unit tests for svg/mask/constraint/split tools) all pass.
- Walked through every process against the live CLI:
  - P1 and P2: ~12 s each.
  - P3: generate + revise.
  - P4/P5: 6 layers, ~136 s. P5's full refine → isolated redraw → fallback-mask chain fired on tiny birds.
  - P6: grab + place.
  - P7: drag, recolour, undo.
  - P8: repair.
  - P9: split a pine into crown and trunk.
  - P10: merge-layers and thicken fixes, each followed by an automatic re-check.
  - P11: zip download.
- A headless-browser pass over all six tabs showed no console errors, and dragging committed a canvas version.

## Did the design remind me of a published system?
Partly. Taken together — generate an image → depth layer plan → segment with text prompts → inpaint what's
behind → arrange layers → fabrication constraint check → per-layer SVG export — it reminded me of
HCI research on **AI-assisted design of layered physical artworks / laser-cut or papercut fabrication**.
I can't name one specific paper with confidence, and I didn't look anything up.

The structure of process 4 (detection prompts → `model_3` that turns prompts into masks → mask-to-vector
translation → fill prompt → `model_2` inpainting) closely matches a common published **pipeline pattern**:
an LLM/VLM planner, a Grounding-DINO + SAM style open-vocabulary detector/segmenter, and a diffusion
inpainting model for layer decomposition. Several choices come from that background knowledge rather than from the design:
- Treating model_3 as a *promptable segmenter*, model_2 as an *image generator / inpainter*, and model_1 as a *vision-language planner*.
- Reading P4's loop as front-to-back *peeling* with inpainting behind removed objects.
- Reading P5 as a mask-quality fallback that has the generator redraw the object in isolation on a plain background and then thresholds it.
- The fabrication framing (sheets, min feature width, loose fragments, support from the layer behind, mm-scaled SVG with hairline cuts).

Everything about representing images as SVG, using SVG shape ids as the segmentation output, and the specific
checks, thresholds, fix tools and UI is my own engineering to make it run on the Claude CLI alone.
