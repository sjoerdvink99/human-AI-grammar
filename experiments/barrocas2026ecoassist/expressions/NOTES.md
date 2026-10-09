# NOTES — decisions the design did not determine

The design consists only of four expressions. It has no goal, no description, no representation
descriptions, no references and no images. Everything below is my choice.

## Interpretation
- **Purpose.** I read the design as "generate web code with an LLM, then reduce its *display* energy". The
  evidence is renderings → `evaluation numeric` energy, and pages that are modified and re-measured. I chose an
  **OLED display-power** reading over CPU or network energy because the energy is evaluated from a *visual*
  rendering.
- **training_webpages_1.** These are 12 synthetic, self-contained, light-themed HTML pages generated
  deterministically by `scripts/make-corpus.js` (6 palettes × 6 layouts: landing, blog, dashboard, pricing,
  gallery, docs). I did not use a real web crawl.
- **tool_3 modify.** There are 7 rule-based CSS strategies (dark colour scheme via invert+hue-rotate, black root
  background, removing background images, dimming media, reducing blue via sepia, lowering brightness, desaturating). Each page
  gets 7 single-strategy variants plus 3 random 2–3-strategy combinations, using a seeded RNG, for 120 variants in total.
- **tool_4 select.** The filter keeps pairs that save at least 2% energy. There is no visual-quality filter.
- **model_2 train / optimizer_weights.** No fine-tuning is possible through a CLI. Instead, "training" fits a
  numeric weight vector (ridge least squares, λ=0.05, no intercept) that predicts the fractional savings of each strategy.
  At inference, model_2 is Claude (Sonnet by default, `OPTIMIZER_MODEL`), prompted with those weights, ranked,
  as its policy. model_2 therefore has a trained numeric component and a generative rewriting component. Both
  sit behind the `model_2` name.
- **Training trigger.** You start training by hand, from a button in the "Train optimizer" tab (streamed with SSE) or with
  `npm run train`. The weights persist in `data/optimizer_weights.json` (one trained file is included). The
  Optimize button stays disabled until weights exist.
- **model_choice_1.** The choices are a fixed set {haiku, sonnet, opus}, passed to the CLI `--model`. Sonnet is the default. The set applies
  to model_1 only.
- **code representation.** Code is a single self-contained HTML document with inline CSS/JS. The generator prompt asks for
  no external assets, one CSS declaration per line (so the diffs are granular) and ≤ ~300 lines. Haiku often
  ignores the length limit.
- **tool_1 execute.** Playwright headless Chromium renders at a 1280 px width with full-page height capped at 3000 px.
  Rendering waits for `load` with a 10 s timeout.
- **tool_2 evaluate.** This is a linear OLED pixel power model on sRGB-linearised channels. The coefficients are
  R 0.27, G 0.35, B 0.62, with 1200 mW for a full-white frame plus 80 mW static. Energy is the average over the full rendered
  height, reported in mW and as a fraction of an all-white screen. The coefficients are illustrative, not calibrated.
- **savings / energy_savings.** Each saving is stored as `{absoluteMw, relative}`. The UI shows it as a large percentage plus two bars.
- **tool_5 extract (diff_1).** The diff is a line diff (jsdiff `diffLines`). Each contiguous run of removed/added lines is
  one edit, with 2 lines of context.
- **human select.** Every edit has a checkbox. All edits are selected by default, and there are Select all/none
  controls. Unselected edits are dimmed.
- **tool_5 modify.** code_3 is code_1 with only the selected edit blocks replaced by their code_2 text. Edit blocks
  never overlap, so any subset applies cleanly. The result may be syntactically odd if the user splits
  interdependent edits; the app does no checking.
- **tool_5 translate / preview_1.** The browser renders code_3 in a sandboxed iframe (`allow-scripts`, no
  same-origin). I added a "Download HTML" button as a convenience; it is not a design step.
- **Energy of code_3** is not measured, because the design has no such step.
- **Regeneration (~).** "Regenerate" and "Optimize again" buttons re-run the generative steps. A new code_1 resets
  all downstream state. Earlier rounds are not kept because the design never compares them.
- **Output validation.** HTML is extracted from the fenced block and must contain an HTML element.
  The optimizer retries once on invalid output, but not after a timeout. Model calls time out after 600 s, and the HTTP
  request timeout is disabled so long model calls can finish.
- **Model prompts** are in `server/generator.js` and `server/optimizer.js`. The optimizer prompt contains only
  code_1, optimizer_weights_1 and energy_before_1, the state that precedes `[model_2 modify]`. It asks for in-place
  edits rather than a global filter, so that the human select step has meaningful edits to choose between.
- **Stack.** Node 20, Express, vanilla JS front end with no build step, Playwright, pngjs, diff, and `node --test`.
  There is no TypeScript, so `npm run check` is `node --check` over all files.
- **Layout and styling.** The app uses a dark UI with two tabs. The Build tab is a vertical wizard of 4 numbered cards (Describe →
  Optimize → Review edits → Preview). The pipeline is shown as status chips named after the design's
  tool/model steps. Before and after screenshots sit side by side with scroll. The Train tab shows a log, a weights
  table with bars, and a candidate-pairs table with selected/rejected rows.

## Verification
- `npm test`: 5 tests pass (diff/apply, ridge recovery of known weights, HTML extraction, render+energy).
- `npm run train`: 12 pages and 120 variants; 73 pairs selected. dark_color_scheme gets the highest weight (≈0.57).
- I drove the UI end to end in headless Chromium: Haiku generation → optimize (−68% estimated power, 16 edits) →
  select 1 edit → apply → preview. Every transformation in all 4 processes was reached.

## Did the design remind me of a published system?
Not of one specific system I can name with confidence. The *idea* of reducing OLED display power by
recolouring web pages reminded me of **Chameleon** (Dong & Zhong, MobiSys 2011), a colour-adaptive mobile
browser for OLED displays, and of the related pixel-level OLED power-modelling work by the same authors. It
also loosely resembled recent research on "green"/energy-aware LLM code generation, but I could not place a
specific paper matching this pipeline (offline training pairs → trained optimizer → human-selected diff).

Choices that came from that background knowledge rather than from the design:
- reading "energy" as OLED display power, and estimating it from screenshot pixels;
- the linear per-channel pixel power model, with blue as the most expensive channel, applied in linear light;
- the edit strategies (dark scheme, black backgrounds, dimming, reducing blue, desaturating), which are the classic
  OLED power-saving transformations from that line of work.
Everything else (the weight-vector reading of `model_2 train`, the diff-hunk selection UI, the prompts and the stack) is my own
choice.
