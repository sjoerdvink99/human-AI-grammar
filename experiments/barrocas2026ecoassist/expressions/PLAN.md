# PLAN — System X (energy-aware web code generation)

The design has no goal, description, representation descriptions, references or images.
From the expressions I infer: **an LLM generates a web page from a request; a second, trained
optimizer model rewrites the page so it uses less display energy (render → measure energy);
the user reviews the diff and keeps only the edits they want; the result is previewed.**
Process 1 trains that optimizer offline from a corpus of web pages.

## Stack (repository was empty — recommended default taken)
- Node 20, Express backend (`server/`), single-page vanilla-JS frontend (`public/`), no build step.
- Playwright (headless Chromium) for rendering, `pngjs` for pixel decoding, `diff` (jsdiff) for diffs.
- All model calls go through one function `callModel()` in `server/model.js`, which runs
  `claude -p --output-format json` with `CLAUDECODE` removed from the environment.
- Persistence: JSON files under `data/` (training corpus, trained weights); session state in browser memory.
- Tests: `node --test`.

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| training_webpages (v1) | `Page[]` `{id, html}` | seed corpus of self-contained HTML pages | `data/training/*.html`, `server/training.js` |
| training_webpages (v2) | `Variant[]` `{pageId, strategies[], html}` | the pages after rule-based energy edits | `server/strategies.js` |
| baseline_renderings / optimized_renderings | PNG buffers | full-page screenshots (1280 wide, ≤3000 tall) | `server/render.js` |
| baseline_energy / optimized_energy | `number[]` | estimated OLED power per page (mW-equivalent units, mean per pixel × area) | `server/energy.js` |
| energy_savings | `number[]` | relative savings (0..1) per variant | `server/training.js` |
| candidate_training_pairs | `{pageId, strategies, x: 0/1 vector, before, after, savings}[]` | all original→variant pairs | `server/training.js` |
| training_pairs | same, filtered | pairs with savings ≥ 2% | `server/training.js` |
| optimizer_weights | `{strategies:[{id, weight}], bias, trainedAt, nPairs}` | least-squares weights: expected savings contributed by each edit strategy | `data/optimizer_weights.json` |
| request | string | user's description of the web page | UI textarea |
| model_choice | `'haiku' \| 'sonnet' \| 'opus'` | which generator model | UI toggle buttons |
| code (v1/v2/v3) | string (HTML) | generated / optimized / user-merged page | `public/app.js` state `code[1..3]` |
| baseline_rendering / optimized_rendering | PNG (data URL) | screenshots shown side by side | `server/render.js` |
| energy_before / energy_after / savings | numbers | shown as values + bars | `server/energy.js` |
| diff | `Edit[]` `{id, removed, added, startLine}` | line-level change blocks code_1→code_2 | `server/diff.js` |
| selected_edits | `string[]` of edit ids | checkboxes on the diff | UI |
| preview | iframe render | sandboxed live preview of code_3 | UI |

## Transformations

| Process | Step | Function | File |
| --- | --- | --- | --- |
| 1 | tool_1 execute | `renderHtml()` | `server/render.js` |
| 1 | tool_2 evaluate | `estimateEnergy()` | `server/energy.js` |
| 1 | tool_3 modify | `applyStrategies()` (random strategy subsets per page) | `server/strategies.js` |
| 1 | tool_4 evaluate / compose / select | `computeSavings()`, `composePairs()`, `selectPairs()` | `server/training.js` |
| 1 | model_2 train | `trainOptimizer()` (ridge least squares) | `server/training.js` |
| 2 | model_1 generate~ | `generateCode()` → `callModel()` | `server/generator.js` |
| 3 | tool_1 / tool_2 | `renderHtml()`, `estimateEnergy()` | |
| 3 | model_2 modify~ | `optimizeCode()` → `callModel()` conditioned on optimizer_weights | `server/optimizer.js` |
| 3 | tool_5 evaluate / extract / modify | `computeSavings()`, `extractEdits()`, `applyEdits()` | `server/diff.js`, `server/energy.js` |
| 3 | human select | diff checkboxes | `public/app.js` |
| 4 | tool_5 translate | sandboxed iframe `srcdoc` | `public/app.js` |

## Open choices and defaults
- **model_2 "train"**: no fine-tuning is possible with only a CLI; model_2 = a learned numeric policy
  (weights over edit strategies) + Claude as the rewriting engine conditioned on those weights.
- Energy model: linear OLED pixel power model on gamma-decoded RGB (blue most costly).
- Training runs from a "Train optimizer" button (Training tab) and from `npm run train`.
- Layout: two tabs — "Build" (processes 2–4) and "Train" (process 1).
