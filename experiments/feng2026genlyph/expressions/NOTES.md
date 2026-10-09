# NOTES — decisions the design did not determine

The design gives only the eight expressions: no goal, no system or process descriptions, no representation
descriptions, no references and no images. Everything below was chosen by me.

## Interpretation of the overall system
- Read as: a tool for authoring **pictorial glyphs** for a tabular dataset with generative AI, ending in a
  "fragmented glyph visualization" (I expanded the identifier `fgv` to that phrase from `fragments`/`glyphs`).
- `dataset_1` is a CSV the user uploads; one glyph per row.
- `masks` partition the glyph image into parts; `attribute_mappings` bind a part to a data attribute.
  Categorical attributes are encoded by *generated variants* of the part (process 5, `categorical_fragments`);
  numeric attributes by *deterministic transforms* of the part (process 6, `numerical_fragments`). I derived this
  split from the identifier names. A mask may carry one categorical and one numeric mapping at the same time.
- Processes are realized as six tabs of one app; processes 2 and 3 share a tab. Tabs unlock once their inputs exist.
- The connections list says process 3 continues from candidate_images_2, but processes 1 and 3 share `candidate_images`;
  I let the user pick from any round (keyword-based or concept-based) in one gallery.

## Model steps (all through `server/llm.mjs → callModel()`; Claude Code CLI, `--tools ""`, `--no-session-persistence`, custom `--system-prompt`, run from the OS temp dir)
- **No image model available**: `model_2` (images) and `model_5` (fragment variants) are Claude writing **SVG**.
  Consequence: `model_3 extract` (segmentation) is Claude choosing SVG element ids, not a pixel segmenter, and masks are
  sets of SVG elements instead of bitmaps.
- `model_1` prompt: list 12–20 concrete drawable visual metaphors as `keyword | weight(1–10)` lines.
- `model_2` prompt: flat icon-style SVG, viewBox 0 0 256 256, 8–40 separately drawn parts, no text/images/scripts.
  Four images per round (one per top-4 active keyword in process 1; four samples of the same prompt in process 2).
- `model_3` prompt: SVG + table of elements (id, tag, fill, bbox computed in the browser) + user rectangles →
  JSON `{masks:[{region,name,eids}]}`. Returned ids are validated against the real elements; masks are made disjoint
  (newer masks claim shared elements).
- `model_4` prompt: full glyph + each fragment SVG → one-sentence description per fragment, JSON array, count validated.
- `model_5` prompt: original fragment SVG + editable encoding prompt → SVG with the *same viewBox* (forced by the
  server so the variant drops into the same place in the glyph).
- Validation of all generated SVG: extract the `<svg>` element, strip scripts/foreignObject/image/text/use/event
  handlers/external hrefs, normalise root attributes, tag shapes with `data-eid`, reject <2 shapes. IDs inside SVGs
  are prefixed per image/variant so gradients don't collide when many glyphs share a page.
- All model roles use the CLI's default model unless `CLAUDE_MODEL` / `MODEL_1..5` are set. Concurrency 4, 4-min timeout.
- Generative outputs (`~`): spinners while pending, per-image error + Retry, regeneration buttons, version history
  (v1, v2…) for categorical fragments, rounds history for candidate images. No streaming (CLI JSON mode returns whole).

## Tool steps
- `tool_1 extract` (attributes): numbers → numeric (min/max); all-unique strings with >8 rows → identifier; else
  categorical. User can override the kind per column.
- `tool_1 translate` (description): plain-text column summary + 5 sample rows.
- `tool_1 translate` (word cloud): own spiral-placement SVG word cloud, font size ∝ weight; clicking a word toggles
  whether it is used in prompts (a small addition to make the keyword list actionable).
- `tool_1 compose` prompts: templates in `web/src/tools/prompts.ts`. Encoding prompts: one per (categorical
  fragment, category value), mentioning the other values so variants are distinguishable.
- `tool_2 extract`: renders the SVG off-screen, flattens each masked element with its CTM, edge = union bbox + 2 units
  padding. Also records the draw order ("skeleton") so assembled glyphs keep the original z-order.
- `tool_3 extract` (contours): rasterises the fragment and all its variants at 128 px, convex hull of opaque pixels,
  bbox and centre anchor. Displayed as red hulls.
- `assembly_settings`: show/hide unmapped base; per numeric attribute: channel ∈ {scale, stretchY, stretchX, rotate,
  opacity, lightness}, output range, anchor (center/bottom/top). Defaults: scale 0.5→1.4 around the centre.
  Lightness uses an SVG `feComponentTransfer` filter so it survives PNG export.
- `tool_4 match`: rule-based recommender, not a model: scatter if x and y are numeric, grouped grid if a categorical
  group is set, sorted grid if a sort key is set, circular for ≤40 rows, grid always. Each option has a score and a reason.
- `layout`: type + padding + labels on/off + axes on/off; placement: x, y, sort, group, label attribute, glyph size,
  canvas width. FGV and glyphs recompose live on every change (the `human modify` loops).
- Glyphs are drawn with `overflow=visible`, so a part scaled above 1× can spill outside its layout cell instead of being cut off.
- Retrying a failed candidate image adds a new one-image round to the gallery; it does not replace the failed one in place.
- Export: PNG at 2× via canvas, or the raw SVG (I added SVG as the second value of the categorical `export_request`).

## Stack, layout and styling
- Node 20 + Express 5 backend (plain ESM), Vite + React 19 + TypeScript frontend, zustand store, no CSS framework.
- Neutral light UI, dark header with numbered tabs and a thumbnail of the chosen glyph; two-column panels per tab.
- No persistence beyond the browser session. Sample dataset: 16 fruits (`data/fruits.csv`), invented values.
- Tests: `node --test` with `tsx` for deterministic tools and the API using `MODEL_PROVIDER=mock`;
  `scripts/walkthrough.mjs` drives all eight processes in headless Chromium (Playwright) with real model calls.

## Did the design remind me of a published system?
Yes. The pipeline (dataset → keywords/word cloud → text-to-image candidates → pick an image → segment it with a
promptable segmenter from user-drawn regions → map parts to attributes → generate categorical variants of parts →
numeric transforms → glyph layout recommendation → export) strongly resembles the research line on **AI-assisted
pictorial glyph / pictorial visualization authoring** — most specifically systems such as **ChartSpark** (Xiao et al.,
semantic-context-aware pictorial charts with text-to-image) and a later glyph-specific successor that uses
text-to-image generation plus a SAM-style segmenter to build data-driven glyphs (I believe something like
"GlyphCreator"/"GlyphGen"-style work, but I can't name it with confidence, so I am not claiming a specific paper).
Choices influenced by that background knowledge rather than the design:
- Interpreting `model_3 extract` from `regions` as a **promptable segmenter** (SAM-like: user boxes → masks) and
  `masks` as part masks; I approximated it with Claude over SVG elements because no vision/segmentation model is available.
- Interpreting `fgv` as a visualization made of glyphs whose **fragments** carry data, and the categorical vs.
  numerical split (generated variants vs. size/opacity-style transforms).
- Having keywords feed a **word cloud** used as an ideation aid before text-to-image generation.
- Offering scatter / grouped / sorted grid layouts as the "layout recommendation" options.
Everything else (prompts, SVG approach, rules, UI) was my own choice for this implementation.
