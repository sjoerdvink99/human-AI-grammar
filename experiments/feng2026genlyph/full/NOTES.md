# NOTES — decisions the design did not determine

The design (design.json) fixes the eight processes, their steps, actors and representation contents. Everything
below was left open and is my choice.

## Stack and architecture
- **Stack:** Vite + React 19 + TypeScript front end; Express back end run with `tsx`. One `package.json`.
- **Libraries:** `papaparse` (CSV parsing), `express`. No chart, word-cloud, state or UI library; all visuals are hand-built SVG.
  Dev: `vitest` (unit tests), `playwright` (scripted walkthrough), `concurrently`.
- **State:** a single React context store (`src/store.tsx`) with fields named after the design identifiers. No persistence; reloading loses the session. Export is the only output.
- **Ports:** API 8791, UI 5191 (8787 was occupied on the build machine).
- **Model provider:** one function `callModel(role, …)` in `server/llm.ts` spawning `claude -p --output-format json --no-session-persistence --system-prompt … --json-schema …` with `CLAUDECODE` removed, cwd = OS temp dir, tools disabled (`--tools ""`) except `Read` for the vision role. Concurrency limited to 4 parallel CLI processes. Per-role model override via `MODEL_1`…`MODEL_5`. Structured output via `--json-schema`, with a fallback that pulls JSON out of free text.
- **Distinct model roles:** model_1…model_5 each have their own system prompt and schema (server/models.ts).

## Substituting the non-language models (the largest open decision)
Only the Claude CLI was available, so the image models are realised over **SVG vector images**:
- **model_2 (image generation):** Claude writes flat SVG illustrations (viewBox 256×256, 6–40 primitive shapes, each visual part a separate shape, no text/images/scripts/filters). One call returns the three candidates for a concept. Output is validated and sanitised on the server (`sanitizeSvg`: strip script/foreignObject/image/text/on* handlers/remote hrefs, require ≥2 shapes) and again in the browser.
- **Normalisation on selection (process 3):** the chosen SVG is mounted off-screen and flattened into a list of shapes, each with a stable `gid`, baked computed style and absolute transform matrix, plus its bounding box. This is what makes later segmentation and recolouring possible.
- **model_3 (segmentation):** Claude receives the SVG, a table of shapes (gid, tag, bbox, fill) and the box prompt, and returns the gids forming the part plus a part name. A mask is therefore a set of shapes, not a pixel mask. Code enforces that mask shapes exist and intersect the box; a shape belongs to only one mask.
- **model_4 (vision-language):** the fragment is rasterised to a 256 px PNG in the browser, written to a temp dir on the server, and Claude reads it with its `Read` tool and returns a ≤12-word noun phrase.
- **model_5 (ControlNet-conditioned diffusion):** Claude receives only the **edge geometry** (gid, tag, bbox per shape, no colours) and the encoding prompts, and returns fill, stroke, texture (none/stripes/dots/crosshatch/waves/grain) and texture colour per shape. Code re-applies these styles to the unchanged geometry, so "conditioning on edges" is enforced in code, not just requested. Colours are validated as hex; unknown textures become `none`. One call per part covers all its category values (so the model sees them together and can keep them distinct); single-value regeneration sends one prompt.
- **tool_2 (edge detection):** with vector input, an "edge map" is the part's shapes rendered stroke-only (`fill="none"`, black stroke) on white.
- **tool_3 contours:** convex hull of the part's shape bounding boxes, plus bbox and centre.

## Data handling
- Attribute typing: a column is numerical if every non-empty value parses as a number; otherwise categorical. Categorical columns with more than 12 distinct values are treated as identifiers: listed but not mappable/emphasisable (keeps model_5 calls bounded). At most 300 rows are loaded.
- Missing numeric values map to the minimum; missing categories keep the original part colours.
- Numerical mapping is min–max normalised over the column.
- Sample dataset `public/samples/garden_plants.csv` (18 invented plants) with a "Use sample" button.

## Model prompts (summarised; full text in server/models.ts and src/tools/tool1.ts)
- model_1: asks for 8 drawable concepts related to the dataset that have several distinct parts, each with weight 1–10 and a reason. tool_1 extract lower-cases, de-duplicates, drops entries over 3 words, clamps weights and keeps at most 10.
- image prompt template (tool_1 compose): "A figurative glyph of: {concept}. Simple, iconic, flat vector illustration with several clearly separated parts that can later be recoloured, resized or repeated to encode data." The same template serves image_prompts_1 and image_prompt_2.
- encoding prompt template: "{fragment description}, coloured and textured to evoke "{value}" ({attribute}); must look clearly different from: {other values}." Editable per value.

## Interaction and layout
- **Overall layout:** a dark left rail with 6 steps (P2+P3 share "Refine & select"; P7+P8 share "Arrange & export"); later steps unlock as their inputs exist. The main area uses cards in one or two columns.
- **P1:** runs automatically on upload: keywords, then image generation for all keywords in parallel, with images showing up per concept as they arrive. Per-concept regenerate (↻) and "Suggest again" for keywords. Word cloud: spiral placement with collision checks, font size by weight, fixed 8-colour palette; clicking a word moves you to P2 with that word filled in.
- **P2:** word cloud plus a mini gallery of the P1 candidates for inspiration, a concept textarea (Ctrl/⌘+Enter generates), "Generate" and "Refresh" buttons. Each round is kept, newest first, with "Edit this description" to go back to an earlier prompt.
- **P3:** following the design literally, only candidate_images_2 (refinement rounds) can become the prototype. P1 images lead into P2 through "Refine →".
- **P4:** two modes: "Draw box" (drag a rectangle → model_3 call, pending box pulses) and "Refine active mask" (click shapes to toggle them). Masks are shown as hatched overlays in a per-mask colour. Each mask card has a name field, shape count, Refine/Delete, and categorical/numerical selects. Submit needs at least one attribute on every component.
- **P5:** runs automatically after submit (fragments → descriptions → prompts → variants). Each part shows its fragment, edge map and description, plus one card per category value with a thumbnail, editable prompt and Regenerate. Parts without a categorical attribute keep their original colours.
- **P6:** default assembly is size scaling 0.5–1.3×; duplication defaults to 1–5 copies, spacing 4 px. Horizontal copies are centred on the original, vertical copies stack upwards, path copies rotate around the glyph-image centre (an arc) with an adjustable angle step. Layer order is shown as a list with ↑/↓ buttons, with "base" holding the unmapped shapes. All glyphs share one square viewBox, so sizes are comparable across glyphs. The preview recomposes live as settings change.
- **P7:** themes light / dark / paper (background, text colour, font). Emphasis chips allow at most 2. Rules in tool_4: none → grid; 1 numerical → axis (alt: sorted grid); 1 categorical → grouped clusters (alt: sorted grid); 2 numerical → scatter; 2 categorical → matrix; categorical + numerical → strips (category rows × numeric x). The recommendation is re-run whenever the emphasis changes, and the recommended layout is preselected. Controls: glyph size, spacing, canvas width, title, label column, axes on/off; glyphs can be dragged (stored as per-row position overrides), with a reset button. Overlaps along an axis are avoided by stacking glyphs into lanes.
- **P8:** export as PNG at 1×, 2× or 4× scale, rasterised in the browser via canvas and downloaded as `<title>@<scale>x.png`.
- No legend is drawn in the visualization itself (the design's compose step only has layout, placement settings, glyphs and dataset); category values appear as group/strip/matrix labels.

## Verification
- `npm run build` (tsc + vite) passes; `npm test` runs 8 unit tests of tools 1–4, the layouts and SVG sanitisation.
- `e2e/walkthrough.mjs` drove all 8 processes against the real Claude CLI in headless Chromium: 8 keywords, 24 P1 images, 3 refinement candidates, 2 masks by model_3, 2 model_4 descriptions, 3 model_5 variants plus one regenerated variant after a prompt edit, 18 assembled glyphs, the strip layout recommended, one glyph dragged, and a 2× PNG exported. Screenshots are in `e2e/shots/`. Every transformation in the design was reachable.

## Did the design remind me of a specific published system?
It reminded me of a *family* of work rather than one system I can name with confidence. Generating pictorial elements
with text-to-image models for charts made me think of **ChartSpark** (Xiao et al., IEEE VIS 2023), and cutting image
parts out to bind to data made me think of **DataQuilt** (Zhang et al., IUI 2020) and Infomages-style work. The
specific pipeline here (SAM-style box segmentation, ControlNet variants per category, size/duplication encodings,
rule-based placement) seems to come from a more recent figurative-glyph authoring paper, but I don't recall its
name or its interface, and I did not look it up.

None of my concrete choices come from those systems. The layouts, step grouping, prompts, the SVG substitution,
the texture set, the placement rules and the styling all come from the design text plus general visualization
practice (grid / grouped / axis / scatter / matrix / strip as standard unit-visualization layouts). The one place my
background knowledge played a part is the general idea that glyph parts should be recoloured on fixed geometry and
resized or repeated for quantities, but the design already states that.
