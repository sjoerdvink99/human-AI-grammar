# System X — energy-aware frontend IDE

An AI-assisted frontend development environment that generates HTML/CSS/JS, profiles the page's
estimated CPU/GPU/network energy in headless Chromium, asks an energy-optimization model for a
rewrite, and lets the developer accept or reject individual changes before previewing the result.
Built from `design.json` (Human-AI grammar design).

## Run

```bash
npm install
npx playwright install chromium   # if no Chromium is cached
npm run train -- --pages 500      # process 1, offline (≈20–25 min for 500 pages; repo ships a 100-page run)
npm run dev                       # server on :3001, UI on http://localhost:5173
# or: npm run build && npm start  → http://localhost:3001
```

Model calls go through the Claude Code CLI (`claude -p --output-format json`, run with `CLAUDECODE`
unset). Swap provider in `server/llm.ts → callModel()`. `OPTIMIZER_MODEL` sets model_2 (default `sonnet`).

Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Design → code map

| Process | Step | Implementation |
|---|---|---|
| 1 Train | `(training_webpages_1)*` | `generateCorpus()` — `server/train/corpus.ts` |
| 1 | `[tool_1 execute]` → baseline_renderings_1 | `loadPage()/screenshot()` in `server/tools/browser.ts`, called from `measure()` |
| 1 | `[tool_2 evaluate]` → baseline_energy_1 | `measure()` — `server/tools/energy.ts` (CDP per-process CPU time × power model) |
| 1 | `[tool_3 modify]` → training_webpages_2 | `ruleOptimize()` — `server/tools/ruleOptimizer.ts` |
| 1 | `[tool_1 execute]`, `[tool_2 evaluate]` → optimized_renderings_1, optimized_energy_1 | `measure()` |
| 1 | `[tool_4 evaluate]` → energy_savings_1 | `computeSavings()` — `server/train/pipeline.ts` |
| 1 | `[tool_4 compose]` → candidate_training_pairs_1 | `composePairs()` — `server/train/pipeline.ts` → `data/training/candidates.json` |
| 1 | `[tool_4 select]` → training_pairs_1 | `selectPairs()` → `data/training/pairs.json` |
| 1 | `[model_2 train]` → optimizer_weights_1 | `trainOptimizer()` — `server/train/train.ts` → `data/optimizer_weights.json` |
| 2 Generate | request_1 + model_choice_1 | `GeneratePanel` — `web/src/components/GeneratePanel.tsx` |
| 2 | `[model_1 generate]~` → code_1 | `generateCode()` — `server/models.ts`, `POST /api/generate` |
| 3 Optimize | `[tool_1 execute]`, `[tool_2 evaluate]` → baseline_rendering_1, energy_before_1 | `measure()` in `POST /api/optimize` — `server/index.ts` |
| 3 | `[model_2 modify]~` → code_2 | `optimizeCode()` — `server/models.ts` (conditioned on optimizer_weights_1) |
| 3 | `[tool_1 execute]`, `[tool_2 evaluate]` → optimized_rendering_1, energy_after_1 | `measure()` |
| 3 | `[tool_5 evaluate]` → savings_1 | `computeSavings()` — `server/tools/feedback.ts`; shown by `EnergyComparison` in `ReviewPanel.tsx` |
| 3 | `[tool_5 extract]` → diff_1 | `extractDiff()` — `shared/diff.ts` |
| 3 | `[human select]` → selected_edits_1 | hunk checkboxes in `web/src/components/ReviewPanel.tsx` |
| 3 | `[tool_5 modify]` → code_3 | `applySelected()` — `shared/diff.ts`, called by `applyEdits()` in `web/src/App.tsx` |
| 4 Preview | `[tool_5 translate]` → preview_1 | `toPreviewDocument()` — `shared/preview.ts`, `PreviewPanel.tsx` (sandboxed iframe) |

Energy numbers are **estimates** from Chromium's per-process CPU time (renderer = CPU work,
GPU process = GPU proxy) and transferred bytes, using the constants in `POWER_MODEL`.
See `NOTES.md` for all decisions the design left open.
