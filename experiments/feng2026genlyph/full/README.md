# Figurative Glyph Studio

End-to-end authoring of figurative glyph-based visualizations from a CSV: concept ideation, image generation,
segmentation into parts, categorical (colour/texture) and numerical (size/duplication) encoding, assembly,
rule-based placement and PNG export. Built from `design.json` (Human-AI grammar design "System X").

## Run

Requirements: Node 20+, and the Claude Code CLI (`claude`) installed and logged in. No API key is needed.

```bash
npm install
npm run dev        # API on :8791, UI on http://localhost:5191
npm test           # unit tests of the deterministic tools
npm run build      # type check + production bundle
npm start          # serves dist/ + API on :8791 (after build)
node e2e/walkthrough.mjs   # drives all 8 processes in headless Chromium (needs `npm run dev`)
```

Environment: `MODEL` (all roles) or `MODEL_1` … `MODEL_5` to choose a Claude model per role,
`MODEL_CONCURRENCY` (default 4), `PORT`.

## Model provider

Every model step goes through **one function**, `callModel(role, …)` in `server/llm.ts`. It spawns
`claude -p --output-format json` with `CLAUDECODE` removed from the environment, a role-specific system prompt and a
JSON schema. Replace that function to swap providers. Because only a language/vision model is available, the image
models are realised over **SVG**: model_2 draws flat SVG illustrations; model_3 segments by returning shape ids; model_5
recolours/retextures a fixed geometry (see NOTES.md).

## Design → code map

| Process | Step | Code |
| --- | --- | --- |
| 1 Recommend figurative concepts | `dataset_1` upload | `parseCsv` — src/tools/tool1.ts, ConceptsPanel |
| | `[tool_1 extract]` → attributes_1 | `extractAttributes` — src/tools/tool1.ts |
| | `[tool_1 translate]` → dataset_description_1 | `describeDataset` — src/tools/tool1.ts |
| | `[model_1 generate]~` → keyword_response_1 | `generateKeywords` — server/models.ts (`POST /api/keywords`) |
| | `[tool_1 extract]` → keywords_1* | `extractKeywords` — src/tools/tool1.ts |
| | `[tool_1 translate]` → word_cloud_1 | `layoutWordCloud` — src/tools/wordcloud.ts, `WordCloud` component |
| | `[tool_1 compose]` → image_prompts_1* | `composeImagePrompts` — src/tools/tool1.ts |
| | `[model_2 generate]~` → candidate_images_1* | `generateImages` — server/models.ts (`POST /api/images`) |
| 2 Refine figurative image candidates | `[human specify]` → concept_prompt_1 | word-cloud click / textarea — src/panels/RefinePanel.tsx |
| | `[tool_1 compose]` → image_prompt_2 | `composeImagePrompt` — src/tools/tool1.ts |
| | `[model_2 generate]~` → candidate_images_2* | `generate()` in RefinePanel → `/api/images` |
| | `[human modify]` → concept_prompt_1 (loop) | "Refresh" / edit description; all rounds kept |
| 3 Select figurative prototype | `[human select]` → glyph_image_1 | "Use as prototype" → `normalizeGlyphImage` — src/tools/svg.ts |
| 4 Segment and map glyph components | `[human select]` → regions_1* | box drawing — src/panels/SegmentPanel.tsx |
| | `[model_3 extract]` → masks_1* | `segmentRegion` — server/models.ts (`POST /api/segment`) |
| | `[human modify]` → masks_2* | "Refine active mask" (click shapes to toggle), rename, delete |
| | `[human assign]` → attribute_mappings_1* | categorical / numerical selects per component |
| 5 Generate and refine categorical encodings | `[tool_2 extract]` → fragments_1*, fragment_edges_1* | `extractFragments` — src/tools/tool2.ts |
| | `[model_4 generate]~` → fragment_descriptions_1* | `describeFragment` — server/models.ts (`POST /api/describe`) |
| | `[tool_1 compose]` → encoding_prompts_1* | `composeEncodingPrompts` — src/tools/tool1.ts |
| | `[model_5 generate]~` → categorical_fragments_1* | `encodeFragment` — server/models.ts (`POST /api/encode`), `generateEncodings` — src/pipelines.ts |
| | `[human modify]` → encoding_prompts_1* (loop) | prompt textareas + "Regenerate" — src/panels/EncodePanel.tsx |
| 6 Encode numerical attributes and assemble glyphs | `[tool_3 extract]` → fragment_contours_1* | `extractContours` — src/tools/tool3.ts |
| | `[human specify]` → assembly_settings_1 | settings form — src/panels/AssemblePanel.tsx |
| | `[tool_3 translate]` → numerical_fragments_1* | `translateNumerical` — src/tools/tool3.ts |
| | `[tool_3 compose]` → glyphs_1* | `composeGlyphs` — src/tools/tool3.ts (`useGlyphs`) |
| | `[human modify]` (loop) | settings edits recompose live |
| 7 Arrange and style the visualization | `[human specify]` → placement_settings_1 | theme buttons + ≤2 emphasis chips — src/panels/ArrangePanel.tsx |
| | `[tool_4 match]` → layout_recommendation_1 | `recommendLayout` — src/tools/tool4.ts |
| | `[human select]` → layout_1 | layout option buttons (recommended preselected) |
| | `[tool_3 compose]` → fgv_1 | `composeFgv` — src/tools/fgv.ts |
| | `[human modify]` (loop) | size / spacing / width / title / labels / axes sliders, drag glyphs |
| 8 Export final visualization | `[human specify]` → export_request_1 | "PNG 1× / 2× / 4×" buttons |
| | `[tool_3 translate]` → fgv_png_1 | `exportPng` — src/tools/exportPng.ts |
