# System X — pictorial glyph designer

Implementation of `design.json` (Human-AI grammar, 8 processes): turn a CSV dataset into a
**fragmented glyph visualization (FGV)** — one pictorial glyph per data row, whose parts encode attributes.

## Run

```bash
npm install
npm run build && npm start        # http://localhost:3001
# or, for development: npm run dev  (Vite on :5173, API on :3001)
npm test                          # deterministic tools + API with a mock model
npm run typecheck
node scripts/walkthrough.mjs      # headless end-to-end run of all 8 processes (real model calls)
```

Model calls use the local Claude Code CLI (`claude -p --output-format json`, with `CLAUDECODE` removed from the
environment). The provider is isolated in `server/llm.mjs → callModel()`. Environment variables:
`CLAUDE_MODEL` (default model for all roles), `MODEL_1`…`MODEL_5` (per role), `MODEL_CONCURRENCY` (default 4),
`MODEL_TIMEOUT_MS`, `MODEL_PROVIDER=mock` (canned outputs for tests).

Because only a text model is available, every generated *visual* (candidate images, categorical fragments) is an SVG
drawn by the model; this is what makes element-level segmentation and fragment cut-outs possible.

## Design → code map

| Process | Transformation | Code |
| --- | --- | --- |
| 1 | `[tool_1 extract]` dataset → attributes | `extractAttributes` — web/src/tools/attributes.ts |
| 1 | `[tool_1 translate]` attributes → dataset_description | `describeDataset` — web/src/tools/attributes.ts |
| 1 | `[model_1 generate]~` → keyword_response | `generateKeywords` — server/models.mjs (`POST /api/keywords`) |
| 1 | `[tool_1 extract]` → keywords* | `parseKeywords` — web/src/tools/prompts.ts |
| 1 | `[tool_1 translate]` → word_cloud | `WordCloud` — web/src/components/common.tsx |
| 1 | `[tool_1 compose]` → image_prompts* | `composeImagePrompts` — web/src/tools/prompts.ts |
| 1 | `[model_2 generate]~` → candidate_images_1* | `generateImage` — server/models.mjs (`POST /api/image`) |
| 2 | `[human specify]` concept_prompt | concept textarea — web/src/views/IdeateViews.tsx `ConceptView` |
| 2 | `[tool_1 compose]` → image_prompt_2 | `composeConceptPrompt` — web/src/tools/prompts.ts |
| 2 | `[model_2 generate]~` → candidate_images_2* | `actions.generateFromConcept` → `/api/image` |
| 2 | `[human modify]` concept (loop) | “Regenerate with this concept”; earlier rounds stay in the gallery |
| 3 | `[human select]` → glyph_image | “Use as glyph” → `actions.selectGlyphImage` |
| 4 | `[human select]` → regions* | drag rectangles — web/src/views/SegmentView.tsx |
| 4 | `[model_3 extract]` → masks_1* | `segment` — server/models.mjs (`POST /api/segment`) |
| 4 | `[human modify]` → masks_2* | “Edit active mask” click-to-toggle, rename, delete — `actions.toggleElement` |
| 4 | `[human assign]` → attribute_mappings* | categorical/numeric dropdowns — `actions.assign` |
| 5 | `[tool_2 extract]` → fragments* + fragment_edges* | `extractFragments` — web/src/tools/fragments.ts |
| 5 | `[model_4 generate]~` → fragment_descriptions* | `describeFragments` — server/models.mjs (`POST /api/describe`) |
| 5 | `[tool_1 compose]` → encoding_prompts* | `composeEncodingPrompts` — web/src/tools/prompts.ts |
| 5 | `[model_5 generate]~` → categorical_fragments* | `generateVariant` — server/models.mjs (`POST /api/variant`) |
| 5 | `[human modify]` encoding prompts (loop) | editable prompt + Regenerate; versions kept (v1, v2…) — `FragmentsView` |
| 6 | `[tool_3 extract]` → fragment_contours* | `extractContours` — web/src/tools/contours.ts |
| 6 | `[human specify]` → assembly_settings | settings form — `AssembleView` |
| 6 | `[tool_3 translate]` → numerical_fragments* | `numericalFragments` — web/src/tools/assemble.ts |
| 6 | `[tool_3 compose]` → glyphs* | `composeGlyphs` — web/src/tools/assemble.ts |
| 6 | `[human modify]` settings (loop) | live form; glyphs recompose on every change |
| 7 | `[human specify]` → placement_settings | placement form — `LayoutView` |
| 7 | `[tool_4 match]` → layout_recommendation | `recommendLayouts` — web/src/tools/layout.ts |
| 7 | `[human select]` → layout | click a recommendation card — `actions.selectLayout` |
| 7 | `[tool_3 compose]` → fgv | `composeFGV` — web/src/tools/layout.ts |
| 7 | `[human modify]` layout (loop) | layout form; FGV recomposes on every change |
| 8 | `[human specify]` export_request | PNG / SVG buttons |
| 8 | `[tool_3 translate]` → fgv_png | `exportFGV` — web/src/tools/export.ts |

See `PLAN.md` for the representation table and `NOTES.md` for every decision the design left open.
