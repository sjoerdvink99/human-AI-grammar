# System X — energy-aware page builder

An LLM generates a web page from your request. A trained optimizer then rewrites the page so it
uses less display energy on OLED screens. You review the diff edit by edit, keep the edits you
want, and preview the result.

## Run

```bash
npm install
npx playwright install chromium   # once, if no Chromium is cached
npm run train                     # process 1 (optional: also available in the UI, "Train optimizer" tab)
npm start                         # http://localhost:3000
npm test
```

Model steps run through the local Claude Code CLI (`claude -p --output-format json`, with `CLAUDECODE`
removed from its environment) in `server/model.js#callModel`. To change the provider, replace that one function.
The environment variables `OPTIMIZER_MODEL` (default `sonnet`), `CLAUDE_BIN` and `PORT` are optional.

## Design → code

The design is `design.json`; see `PLAN.md` for the full table of representations.

| Process | Transformation | Implementation |
| --- | --- | --- |
| 1 | `[tool_1 execute]` training_webpages → renderings | `server/render.js` `renderHtml` |
| 1 | `[tool_2 evaluate]` renderings → baseline/optimized_energy | `server/energy.js` `estimateEnergy` |
| 1 | `[tool_3 modify]` training_webpages_1 → training_webpages_2 | `server/strategies.js` `applyStrategies`, `variantPlans` |
| 1 | `[tool_4 evaluate]` → energy_savings | `server/energy.js` `computeSavings` (called in `server/training.js`) |
| 1 | `[tool_4 compose]` → candidate_training_pairs | `server/training.js` `composePairs` |
| 1 | `[tool_4 select]` → training_pairs | `server/training.js` `selectPairs` |
| 1 | `[model_2 train]` → optimizer_weights | `server/training.js` `trainOptimizer` → `data/optimizer_weights.json` |
| 2 | `[model_1 generate]~` request + model_choice → code_1 | `server/generator.js` `generateCode`; UI step 1 |
| 3 | `[tool_1 execute]`, `[tool_2 evaluate]` → baseline_rendering, energy_before | `POST /api/render` |
| 3 | `[model_2 modify]~` code_1 + optimizer_weights + energy_before → code_2 | `server/optimizer.js` `optimizeCode`; `POST /api/optimize` |
| 3 | `[tool_1 execute]`, `[tool_2 evaluate]` → optimized_rendering, energy_after | `POST /api/render` |
| 3 | `[tool_5 evaluate]` → savings | `computeSavings`; `POST /api/compare` |
| 3 | `[tool_5 extract]` → diff | `server/diff.js` `diffForUi`; `POST /api/compare` |
| 3 | `[human select]` → selected_edits | checkboxes in UI step 3 (`public/app.js` `renderDiff`) |
| 3 | `[tool_5 modify]` → code_3 | `server/diff.js` `applyEdits`; `POST /api/apply` |
| 4 | `[tool_5 translate]` code_3 → preview | sandboxed `<iframe srcdoc>` in UI step 4 |

The training corpus (`data/training/`) is produced by `node scripts/make-corpus.js`. Drop in more
self-contained `.html` files and retrain to extend it.
