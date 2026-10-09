# NOTES — decisions the design did not determine

The design gave only four expressions with opaque identifiers (`r1` … `r20`), no name beyond
"System X", no goal, no system or process descriptions, no representation descriptions, no
references and no images. Nearly everything beyond the step structure was my choice.

## Domain and meaning of the representations

| id | design says | my interpretation |
| --- | --- | --- |
| r1 | artifact formal, collection | corpus of matplotlib chart programs (12 seed scripts with typical readability flaws, plus user-added scripts) |
| r1_2 | modified r1 | one variant per (script × edit operator) |
| r2, r4, r13, r15 | artifact visual | PNG rendering, plus text/legend/axes/data-mark bounding boxes captured during rendering (needed by the metrics) |
| r3, r5, r14, r16 | evaluation numeric | six readability penalties in [0,1] (text overlap, clipped text, small text, legend occlusion, unused canvas, missing title/axis labels) and an overall 0–100 score with fixed weights 35/25/10/15/15/10 |
| r6 | evaluation numeric | score delta variant − original |
| r7 | artifact record | training record {script, operator, before, after, delta} |
| r8 | artifact record | records with delta > 0.5 points |
| r9 | artifact numeric | weight matrix: one ridge-regression row per edit operator, features = the six penalties + bias, target = score gain |
| r10 | instruction language | free-text chart request |
| r11 | instruction categorical | chart type: bar, stacked bar, line, scatter, histogram, pie |
| r12 | artifact formal | the chart program: r12_1 generated, r12_2 model-repaired, r12_3 after the human's hunk selection |
| r17 | evaluation numeric | score change r16 − r14 plus per-metric changes |
| r18 | artifact formal | line-diff hunks between r12_1 and r12_2 |
| r19 | selection formal, collection | the hunks the user ticks |
| r20 | artifact visual | final SVG export |

## How "model_2 train" was realised

The CLI cannot be fine-tuned, and the brief said every model step must go through the CLI. I split
model_2 into a learned numeric part and an LLM configuration: `train` fits r9 locally (numpy ridge
regression), and `modify` calls the CLI with a model_2-specific system prompt that gets the
operator gains predicted by r9 for the current metric profile. That keeps r9 numeric and actually used,
but the "training" never changes the LLM itself. This is the biggest gap between the design and
the implementation.

## Tools

* tool_1 execute: runs programs in a separate `python -I` subprocess (Agg backend), with batch execution for the corpus. An AST allow-list (imports limited to matplotlib/numpy/math/random/datetime/…, no `open`/`eval`/`exec`/`savefig`/dunder access) runs first. This is a guard, not a real sandbox.
* tool_2 evaluate: the metrics above. Text overlap uses rotated-rectangle (separating axis) tests so that rotated tick labels are not falsely counted.
* tool_3 modify: eight deterministic edit operators that append code (tight_layout, rotate x ticks, thin x ticks, enlarge figure, larger fonts, legend outside, legend "best", shrink figure).
* tool_4: delta, compose, and a filter at > 0.5 points.
* tool_5: one tool with four operations — score comparison, `difflib` opcode hunks (every non-equal opcode can be selected on its own), hunk application, and SVG export. The design uses the same tool_5 for all four, so I put them in one module group (`diffing.py` + `pipeline_repair.py`). The SVG export runs separately from tool_1 because the design names a different tool for it.

## Triggers and flow (no process descriptions were given)

* Process 1 runs when the user clicks "Build training data & train". The weights are saved to `data/weights.json` and reused.
* Processes 2 and 3 run as one job from a single "Generate & repair" click. No human step comes between them, so the app goes straight on to the first human step (hunk selection). If no model has been trained yet, creation is blocked.
* Process 4 runs as soon as the selected hunks are applied ("Apply selected changes").
* Every hunk starts selected, and the user unticks the ones to drop. Select all/none buttons are available.
* The app keeps the earlier versions r12_1 and r12_2 for the diff. The final view shows a unified diff r12_1 → r12_3 in the API response, and the UI shows the final code.
* The user can change the selection and apply again (the design has no explicit loop; re-applying only re-runs the last step).

## Generative-output handling (`~`)

* Loading state: the backend reports stage names that match the design operations (e.g. "model_2 modify"), and the UI shows them as progress chips.
* model_1 output is validated: the JSON is parsed, then the AST is checked against the allow-list, then a regex confirms the program draws the chosen chart type. On failure the app retries once with the error passed back, then reports the error. model_2 output is checked the same way except for the chart-type regex.
* There is no regenerate button. To regenerate, click "Generate & repair" again.

## Model prompts

* model_1 (`pipeline_generate.build_generate_prompt`): includes the request and chart type, asks for inline example data and plain first-draft code with no layout tuning, and wants JSON `{code}` back.
* model_2 (`repair_model.build_modify_prompt`): includes the program, its metric penalties and score, and the ranked operator gains from r9. It is told to keep the data and chart type, leave untouched lines byte-identical (so the hunks stay small), and may add missing labels. It returns JSON `{code, rationale}`.

## Stack, layout, styling

* Backend: Python stdlib `http.server` (threaded) with matplotlib and numpy. No new dependencies. Jobs run in background threads and the frontend polls them. Sessions live in memory.
* Frontend: vanilla HTML/CSS/JS with no build step. There are two tabs, "Create chart" (default once a model exists) and "Train repair model".
* Create view: four numbered cards. (1) request textarea and a segmented chart-type control. (2) side-by-side before/after renderings, each with its metric bars, a ±score badge, and a collapsible "why" with the model's rationale and the r9 gains. (3) diff hunks with checkboxes. (4) final SVG next to the final code, with SVG and .py download links.
* Train view: corpus list with add/remove for user scripts. A results table shows each original next to its variants as thumbnails, with deltas, and the selected records outlined in green. r9 is shown as a heat-map grid (blue for positive, orange for negative).
* Port 8811, because 8765 was taken on this machine.

## Verification done

* 8 unit tests pass (diff/apply, code validation, chart-type enforcement, JSON extraction, rendering + overlap metric, all operators, train/predict).
* `tests/e2e.py` ran against the live server with real CLI calls and reached every transformation. Example run: r7=96, r8=25. The generated bar chart scored 71.8 (r14) and 100 after repair (r16). The repair produced 2 hunks, and applying 1 of them gave r12_3 and an SVG r20.
* The UI was not driven in a browser. The static files and API endpoints return 200, and `app.js` passes `node --check`.

## Did the design remind me of a published system?

Not of one specific system I can name with confidence. The structure — mutating a corpus of
programs, executing and scoring the renderings, keeping the improving pairs as training data,
training a repair model, and then using it to refine an LLM-generated program — is close to
execution-feedback / self-improvement work on code-generating models. For visualisation in
particular, it resembles chart-code generation with a render-and-critique refinement loop
(LIDA-style generate → evaluate → repair, and the plot-agent / "MatPlotAgent"-style visual-feedback
loops). I did not consult any of these systems. Choices that came from that general background rather
than from the design:

* reading the formal→visual→numeric chain as **plotting code → rendered chart → quality score** (the design only says formal/visual/numeric);
* choosing **matplotlib/Python** as the target language;
* reading r11 as **chart type**;
* treating r18/r19 as **diff hunks the user accepts or rejects**, which is a common code-review affordance and not something the design specifies;
* the specific readability metrics (label overlap, clipping, legend occlusion) come from general visualisation-linting practice, not from any one paper.
