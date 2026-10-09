# PLAN — Figurative glyph authoring (System X)

Empty repository → minimal stack (taken as default, no confirmation needed per experiment rules):

- **Frontend:** Vite + React + TypeScript, single page with a step rail (one panel per process). All visuals are SVG.
- **Backend:** Node + Express (TypeScript via `tsx`). Every model step goes through `callModel(role, …)` in `server/llm.ts`, which spawns `claude -p --output-format json` with `CLAUDECODE` removed from the env. Provider swap = replace that one function.
- **Libraries:** `papaparse` (CSV), `express`. Tests: `vitest`.
- **Persistence:** in-memory React state only; export produces a PNG.

## Substitutions forced by "Claude CLI only"

| Design actor | Realisation |
| --- | --- |
| model_1 language model | Claude, keyword prompt, JSON schema output |
| model_2 image generation model | Claude writes **flat SVG illustrations** (one call → three candidates). SVG keeps parts as separate shapes, which makes segmentation and recolouring possible without pixel models. |
| model_3 segmentation model | Claude receives the box + the shapes (id, type, bbox) of the image and returns the shape ids forming the part = mask. Code clips the result to shapes intersecting the box. |
| model_4 vision-language model | Claude receives the rasterised fragment PNG (read through its Read tool) and describes it. |
| model_5 ControlNet diffusion | Claude receives the fragment **edge geometry** (shapes, no colours) + encoding prompt and returns fill / stroke / texture per shape. Code re-applies these styles to the fixed geometry, so the edge "conditioning" is enforced in code. |
| tool_1..tool_4 | deterministic TypeScript in `src/tools/` |

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| dataset | `Dataset {columns, rows}` | parsed CSV | src/types.ts |
| attributes | `Attribute[]` | name, kind categorical/numerical, values/min/max, usable | src/types.ts |
| dataset_description | string | prose description of attributes | src/tools/tool1.ts |
| keyword_response | string | raw model reply (JSON text) | server/models.ts |
| keywords | `Keyword[]` | word + weight | src/types.ts |
| word_cloud | `WordCloudItem[]` → SVG | placed words | src/tools/wordcloud.ts |
| image_prompts | string[] | one per keyword | src/tools/tool1.ts |
| candidate_images (1/2) | `CandidateImage[]` | SVG + concept + prompt | src/types.ts |
| concept_prompt | string | textarea | src/panels/RefinePanel.tsx |
| image_prompt | string | composed prompt | src/tools/tool1.ts |
| glyph_image | `GlyphImage` | normalised SVG: shapes with gid, baked style, bbox | src/tools/svg.ts |
| regions | `Box[]` | user-drawn boxes | src/types.ts |
| masks (1/2) | `Mask[]` | id, name, box, gids | src/types.ts |
| attribute_mappings | `AttributeMapping[]` | maskId → categorical?/numerical? | src/types.ts |
| fragments | `Fragment[]` | SVG of the part only | src/tools/tool2.ts |
| fragment_edges | `FragmentEdges[]` | geometry outline (no fill) | src/tools/tool2.ts |
| fragment_descriptions | string per fragment | | server/models.ts |
| encoding_prompts | `EncodingPrompt[]` | per (fragment, category value) | src/tools/tool1.ts |
| categorical_fragments | `CategoricalFragment[]` | per (fragment, value) style set | src/types.ts |
| fragment_contours | `FragmentContour[]` | bbox, centre, shape boxes | src/tools/tool3.ts |
| assembly_settings | `AssemblySettings` | per-part mode/range/spacing, layer order | src/types.ts |
| numerical_fragments | `NumericalFragment[]` | per row, per part: transforms of copies | src/tools/tool3.ts |
| glyphs | `Glyph[]` | one SVG per row | src/tools/tool3.ts |
| placement_settings | `PlacementSettings` | theme + ≤2 emphasised attributes | src/types.ts |
| layout_recommendation | `LayoutRecommendation` | recommended + alternatives + rationale | src/tools/tool4.ts |
| layout | `Layout` | type, axes attrs, sizes, spacing, labels, overrides | src/types.ts |
| fgv | SVG string | the composed visualisation | src/tools/fgv.ts |
| export_request | `1 | 2 | 4` scale | categorical buttons | src/panels/ArrangePanel.tsx |
| fgv_png | Blob | PNG download | src/tools/exportPng.ts |

## Transformations (process order)

| # | actor op | implementation |
| --- | --- | --- |
| P1 | tool_1 extract | `extractAttributes` src/tools/tool1.ts |
| P1 | tool_1 translate | `describeDataset` src/tools/tool1.ts |
| P1 | model_1 generate~ | `POST /api/keywords` → `generateKeywords` server/models.ts |
| P1 | tool_1 extract | `extractKeywords` src/tools/tool1.ts |
| P1 | tool_1 translate | `layoutWordCloud` src/tools/wordcloud.ts |
| P1 | tool_1 compose | `composeImagePrompts` src/tools/tool1.ts |
| P1 | model_2 generate~ | `POST /api/images` → `generateImages` server/models.ts |
| P2 | human specify | concept textarea / click keyword, RefinePanel |
| P2 | tool_1 compose | `composeImagePrompt` |
| P2 | model_2 generate~ | `/api/images` |
| P2 | human modify (loop) | edit prompt + "Refresh" / "Generate", rounds kept |
| P3 | human select | "Use as prototype" on a candidate_images_2 card |
| P4 | human select | draw boxes on SegmentPanel canvas |
| P4 | model_3 extract | `POST /api/segment` → `segmentRegion` |
| P4 | human modify | click shapes to toggle in/out of mask, rename, delete |
| P4 | human assign | per-mask categorical / numerical dropdowns |
| P5 | tool_2 extract | `extractFragments` src/tools/tool2.ts |
| P5 | model_4 generate~ | `POST /api/describe` → `describeFragment` |
| P5 | tool_1 compose | `composeEncodingPrompts` |
| P5 | model_5 generate~ | `POST /api/encode` → `encodeFragment` |
| P5 | human modify (loop) | edit encoding prompts, regenerate per value/part |
| P6 | tool_3 extract | `extractContours` src/tools/tool3.ts |
| P6 | human specify | assembly settings form |
| P6 | tool_3 translate | `translateNumerical` |
| P6 | tool_3 compose | `composeGlyphs` |
| P6 | human modify (loop) | settings edits recompose live |
| P7 | human specify | theme + ≤2 emphasis attributes |
| P7 | tool_4 match | `recommendLayout` src/tools/tool4.ts |
| P7 | human select | layout chooser (recommended preselected) |
| P7 | tool_3 compose | `composeFgv` src/tools/fgv.ts |
| P7 | human modify (loop) | size/spacing/labels/axes/title + drag glyphs |
| P8 | human specify | export scale buttons |
| P8 | tool_3 translate | `exportPng` src/tools/exportPng.ts |

## Images
The design lists no images.

## Open choices (defaults taken)
- Model provider: Claude Code CLI (required). Per-role model override via env `MODEL_1`..`MODEL_5`.
- Persistence: none (session state); export only.
- Layout: left step rail, main work area, right context column where useful.
- Categorical attributes limited to ≤ 12 distinct values (keeps model_5 calls bounded); higher-cardinality text columns are listed but not mappable.
- Process 3 selects only from `candidate_images_2` as the design states; the P1 gallery offers "refine this concept" to move into P2.
