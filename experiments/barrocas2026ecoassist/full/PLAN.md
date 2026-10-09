# PLAN — System X (energy-aware frontend IDE)

Design: `design.json` (4 processes, no references, no images).
Plan written per the experiment instructions; the recommended defaults below were taken without waiting for confirmation.

## Stack (empty repo → minimal proposal)

- **Backend**: Node 20 + Express, TypeScript run with `tsx` (`server/`).
- **Frontend**: Vite + React + TypeScript (`web/`), CodeMirror 6 editor, `diff` for line diffs.
- **Browser automation (tool_1)**: Playwright Chromium (already cached locally).
- **Energy profiling (tool_2)**: Chrome DevTools Protocol `SystemInfo.getProcessInfo` CPU time of renderer + GPU processes over a fixed observation window, plus transferred bytes, converted to joules with a documented power model. (No root access on macOS for RAPL/powermetrics, so this is an *estimate*.)
- **Rule-based toolchain (tool_3)**: LightningCSS, Terser, HTML-Minifier-Terser, plus energy rules (lazy images, async decoding). Subfont, Critical, Imagemin and Squoosh are left out (see NOTES.md).
- **Models**: every model call goes through `server/llm.ts → callModel()` which shells out to `claude -p --output-format json` with `CLAUDECODE` removed.
  - model_1 (generate): user-selectable Claude model (haiku / sonnet / opus).
  - model_2 (modify): fixed configuration with its own system prompt, conditioned on `optimizer_weights`.
- **Persistence**: JSON files under `data/` (training artifacts) and in-memory/localStorage for the IDE session.

## Representations

| id | type | contents | file |
|---|---|---|---|
| training_webpages_1 / _2 | `WebCode[]` | synthetic corpus pages (before / after tool_3) | `server/train/corpus.ts`, `data/training/` |
| baseline_renderings_1 / optimized_renderings_1 | `Rendering[]` (screenshot PNG + console errors) | `server/tools/browser.ts` |
| baseline_energy_1 / optimized_energy_1 | `EnergyEstimate[]` | `server/tools/energy.ts` |
| energy_savings_1 | `number[]` (J and %) | `server/train/pipeline.ts` |
| candidate_training_pairs_1 | `TrainingPair[]` | `data/training/candidates.json` |
| training_pairs_1 | `TrainingPair[]` (saved energy, still renders same, no errors) | `data/training/pairs.json` |
| optimizer_weights_1 | `OptimizerWeights` — numeric per-pattern weights + exemplar pairs | `data/optimizer_weights.json` |
| request_1 | string | `web/src/components/GeneratePanel.tsx` |
| model_choice_1 | `"haiku" \| "sonnet" \| "opus"` | same |
| code_1 / code_2 / code_3 | `WebCode {html, css, js}` | `shared/types.ts`, editor in `web/src/App.tsx` |
| baseline_rendering_1 / optimized_rendering_1 | `Rendering` | `server/tools/browser.ts` |
| energy_before_1 / energy_after_1 | `EnergyEstimate` | `server/tools/energy.ts` |
| savings_1 | `{joules, percent}` | `server/tools/feedback.ts` |
| diff_1 | `DiffHunk[]` per file | `shared/diff.ts` |
| selected_edits_1 | `string[]` hunk ids | `web/src/components/ReviewPanel.tsx` |
| preview_1 | live iframe (srcdoc) | `web/src/components/PreviewPanel.tsx` |

## Transformations

| process | step | function / component |
|---|---|---|
| 1 | tool_1 execute | `renderPage()` in `server/tools/browser.ts` |
| 1 | tool_2 evaluate | `profileEnergy()` in `server/tools/energy.ts` |
| 1 | tool_3 modify | `ruleOptimize()` in `server/tools/ruleOptimizer.ts` |
| 1 | tool_4 evaluate | `computeSavings()` in `server/train/pipeline.ts` |
| 1 | tool_4 compose | `composePairs()` |
| 1 | tool_4 select | `selectPairs()` |
| 1 | model_2 train | `trainOptimizer()` in `server/train/train.ts` (no fine-tuning API available → derives numeric pattern weights + exemplar set that conditions model_2) |
| 2 | model_1 generate~ | `generateCode()` in `server/models.ts`, `GeneratePanel` |
| 3 | tool_1 execute / tool_2 evaluate | `measure()` in `server/tools/energy.ts` (via `/api/optimize`) |
| 3 | model_2 modify~ | `optimizeCode()` in `server/models.ts` |
| 3 | tool_5 evaluate | `computeSavings()` in `server/tools/feedback.ts` |
| 3 | tool_5 extract | `extractDiff()` in `shared/diff.ts` |
| 3 | human select | `ReviewPanel` hunk checkboxes |
| 3 | tool_5 modify | `applySelected()` in `shared/diff.ts` |
| 4 | tool_5 translate | `toPreviewDocument()` + `PreviewPanel` iframe |

## Open choices and defaults taken

- Provider: Claude Code CLI; model_1 choices are Claude models (design's GPT-5 example is not available).
- Training corpus: no 500-page dataset ships with the design → seeded synthetic page generator with energy-relevant patterns; `npm run train -- --pages 500` reproduces the design's scale; repo ships a smaller pre-built run.
- Fine-tuning: not possible without a training API → `optimizer_weights` is a learned numeric artifact (pattern → mean measured savings) plus top exemplar pairs used as few-shot context for model_2.
- Layout: three-column IDE — left: generate + optimizer status; center: file tabs editor; right: tabs Review / Preview.
