# NOTES — decisions the design did not determine

The design fixed the processes, actors, representations and the tool list. Everything below was my choice.

## Stack and libraries

| Decision | Choice |
|---|---|
| Stack | Node 20 + Express (TypeScript run with `tsx`) backend; Vite + React + TypeScript frontend; one `package.json` |
| Code editor | CodeMirror 6 via `@uiw/react-codemirror` (HTML/CSS/JS language modes) |
| Diffing | `diff` (jsdiff) `diffLines`, grouped into change blocks ("hunks") |
| Browser automation (tool_1) | Playwright Chromium headless shell |
| "Still works" check | `pixelmatch` + `pngjs` screenshot comparison, plus new console errors |
| Rule toolchain (tool_3) | LightningCSS, Terser, HTML-Minifier-Terser — all from the design's list. **Left out: Subfont, Critical, Imagemin, Squoosh.** Subfont and Critical need a real multi-file site and their own browser; the corpus has no raster images or web fonts, so the image tools would have had nothing to do. I added five deterministic energy rules (clamp sub-frame timers to 16 ms, remove `will-change` declarations that sit on their own line, passive scroll/wheel/touch listeners, `loading="lazy" decoding="async"` on images, `content-visibility:auto` on sections). |
| Tests | Vitest (`tests/core.test.ts`): diff/apply, preview assembly, rule toolchain, pair selection, model-output validation |
| Persistence | Training artifacts as JSON in `data/`; the IDE session (current code + version history) in `localStorage`. No database. |

## Model calls

- One provider function: `callModel()` in `server/llm.ts`. It runs `claude -p --output-format json --model <m> --system-prompt <…> --tools ""` with `CLAUDECODE` removed from the environment and sends the prompt on stdin. Tools are turned off so the CLI acts as a plain model.
- **model_1 (user-selectable)**: the choices are `haiku | sonnet | opus`, because only Claude models can be reached through the CLI. The design's example, GPT-5, is not available. The default is `sonnet`.
- **model_2 (optimizer)**: a separate system prompt and configuration. The model is set by `OPTIMIZER_MODEL` (default `sonnet`).
- **Prompts**:
  - model_1 is told to return a three-file app (`index.html` links `style.css` and `script.js`), with no CDNs, formatted rather than minified, as JSON only: `{html, css, js}`.
  - model_2 gets the learned pattern list ranked by weight, with each pattern's measured joule cost, a list of typical fixes, and up to 3 validated before/after exemplars taken from `training_pairs`. It is told to keep the page's look and behaviour, **not to minify**, and to leave unchanged lines byte-identical so the diff stays reviewable. It returns `{html, css, js, changes[]}`. The user prompt includes the measured `energy_before`.
- **Output validation**: the reply's JSON is extracted (code fences are tolerated). `html`, `css` and `js` must all be strings, and `html` must look like HTML. On failure the call is retried once with a corrective note.
- No streaming of model tokens. Instead, `/api/optimize` streams NDJSON stage events (baseline → optimize → after → result), which the UI shows as a progress list.

## Process 1 (training)

- **Corpus**: the design says 500 webpages but provides none. `server/train/corpus.ts` generates a seeded synthetic corpus: 4 layout templates × a random subset of 10 energy patterns (fast timers, infinite box-shadow/filter animation, layout-property animation, blanket will-change, layout thrashing, rAF busy polling, non-passive scroll handlers, eager images, unminified assets, heavy DOM). `npm run train` defaults to 500 pages. The repository ships a **100-page run** (`data/`), which took about 4 minutes; 49 of the 100 pairs were kept.
- **Energy profiling (tool_2)**: no root access, so there is no RAPL or powermetrics. Energy is *estimated* from Chromium's per-process CPU time (CDP `SystemInfo.getProcessInfo`) over the page load plus an observation window:
  - renderer CPU-seconds × 12 W
  - GPU-process CPU-seconds × 18 W, as a proxy for GPU work
  - transferred bytes × 2e-7 J/B

  Training uses a 1 s window with 1 run. The IDE uses a 2 s window and the median of 3 runs. Measurements are serialized through one browser.
- **tool_1 + tool_2** are separate functions (`loadPage`/`screenshot` and the profiling in `measure()`), but each measurement call does both in one page load.
- **Selection (tool_4 select)**: a pair is kept if it saves ≥ 1 % energy, ≤ 5 % of screenshot pixels differ, and no new console errors appear.
- **"model_2 train"**: fine-tuning is impossible here, because there is no API key or training endpoint. `optimizer_weights` is a *fitted numeric artifact* instead:
  - a weight for each pattern: mean baseline energy of pages with the pattern minus pages without it, normalised by mean page energy
  - the rule toolchain's mean savings on pages with each pattern
  - exemplar pairs

  model_2 is conditioned on this artifact through its prompt. This is the largest departure from the design's intent.
- **Measurement noise**: with 1 run per page, some patterns get negative or zero cost (fast-timer, eager-images, layout-thrashing). Chromium throttles 1 ms timers, and the SVG data-URI images are cheap. These weights are honest measurements, not tuned.
- Training can also be started from the UI ("Offline training pipeline" → Run pipeline), which shows a progress bar.

## Process 2–4 (IDE)

- **Code format**: `WebCode {html, css, js}`, shown as three editor tabs. `index.html` links `style.css`/`script.js`, and `shared/preview.ts` inlines them for the browser and the preview.
- **Layout**: three columns.
  - Left: Generate (request textarea, segmented model picker) and the optimizer panel (bar list of learned pattern weights, training trigger).
  - Centre: file tabs, editor, and an "⚡ Optimize for energy" button.
  - Right: "Energy review" and "Preview" tabs.
- **Energy feedback**: two stacked horizontal bars (CPU/GPU/network) for original and optimized, the % and J saved in green or red, and the original and optimized screenshots side by side. When the diff is empty, a note says the difference is measurement noise. The savings figure is for code_2 as a whole; code_3 with partial acceptance is **not** re-measured, because the design has no step for that, and the UI says so.
- **Selective acceptance**: one checkbox per hunk, all accepted by default. There are Accept all / Reject all / Discard buttons and "Apply N selected". Rejected hunks are dimmed and their additions struck through. Each hunk shows 2 lines of context.
- **After Apply**: code_3 replaces the editor content, a history entry is added, and the right pane switches to Preview (process 4 follows process 3).
- **Preview**: a live sandboxed `iframe srcdoc` (`allow-scripts allow-forms allow-modals`) with Reload and Open-in-new-tab buttons. I chose an interactive iframe rather than a static screenshot so the developer can "check that the application still functions".
- **Version history**: every generated, optimized, restored or example version goes into a History dropdown and can be restored. The design keeps `code_1` alongside `code_2`/`code_3` but does not ask for history.
- **Extras not in the design**:
  - A "Load example" button with a hand-written inefficient dashboard, so optimization can be tried on "manually written code" without generating first.
  - A confirm dialog before generation overwrites existing code.

## Verification performed

- `npm run typecheck` is clean, `npm test` passes 6/6, and `npm run build` succeeds.
- `npm run train -- --pages 100` gave 100 candidate pairs, 49 training pairs and the weights file.
- `scripts/smoke-optimize.ts` ran `/api/optimize` on the example page: 28.5 J → 2.3 J (−92 %), 14 hunks. Applying half of them works.
- `scripts/smoke-ui.ts` drove the real UI in Playwright twice:
  - Generate with haiku → Optimize → review (0 hunks; the page was already efficient) → Preview.
  - Load example → Optimize → 13 hunks, one rejected → Apply 12 → preview iframe renders code_3.
- The UI training trigger (`POST /api/train`, 2 pages) completed. The 100-page weights were restored afterwards.
- Every transformation in the design is reachable. Screenshots are in `docs/`.

## Did the design remind me of a published system?

Not of a specific one I can name with confidence. The combination of profiling webpages for energy, building before/after pairs from rule-based optimizers (LightningCSS, Terser, Critical, Subfont…), fine-tuning an LLM for green frontend code, and an IDE with diff + energy feedback + selective acceptance reads like a recent (2025-era) research prototype on "green"/energy-aware LLM code generation for web frontends. I do not recall its name, authors or details, so I did not look it up and did not use any knowledge of it.

Choices that came from general background knowledge rather than from the design:

- The specific energy-intensive patterns, and the fixes listed in the model_2 prompt: common web-performance knowledge.
- Using CPU time as an energy proxy with a fixed power model: a standard approach when hardware counters are unavailable.
- Unified-diff, hunk-level accept/reject UI: the convention of IDE diff tools and of AI code assistants like Copilot and Cursor, not of any particular paper.
