# PLAN — System X

The design has no goal, description, representation descriptions, references or images. Only the
expressions are given, so the domain is inferred from their structure:

* formal artifacts that are **executed** into visual artifacts, which tools **evaluate** numerically;
* a corpus of such programs is **modified** by a tool, re-executed and re-scored, the score change is
  evaluated, composed into records, filtered, and used to **train** a model (process 1);
* a user writes a request + picks a category, a model generates a program (process 2);
* the trained model repairs that program, a tool measures the improvement and extracts a diff,
  the human selects which parts to keep, a tool applies them (process 3), and the result is
  translated into a final visual (process 4).

**Chosen domain (recommended default):** matplotlib chart code. Visual quality is measured with
deterministic layout/readability metrics (text overlap, clipped text, small fonts, unused
whitespace, legend covering data). The trained model learns which repair edits improve which
metric profiles.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| r1 (`r1_1`, `r1_2`) | `CorpusScript[]` | seed chart scripts (r1_1) and their tool-mutated variants (r1_2, one per script × edit operator) | `backend/corpus.py`, `backend/seed_corpus/*.py` |
| r2, r4, r13, r15 | `Rendering` | PNG (base64) + text/legend/axes bounding boxes captured at render time | `backend/render.py` |
| r3, r5, r14, r16 | `Metrics` | dict of numeric metrics + overall score in [0,100] | `backend/metrics.py` |
| r6 | `number[]` | per-variant score delta (r5 − r3) | `backend/pipeline_train.py` |
| r7 | `TrainingRecord[]` | {script_id, operator, before metrics, after metrics, delta} | `backend/pipeline_train.py` |
| r8 | `TrainingRecord[]` | r7 filtered to delta > threshold | `backend/pipeline_train.py` |
| r9 | `RepairModelWeights` | numeric weight matrix: operators × (metric features + bias), stored in `data/weights.json` | `backend/repair_model.py` |
| r10 | `str` | user's natural-language chart request | frontend textarea |
| r11 | `ChartType` | one of bar, line, scatter, pie, histogram, stacked_bar | frontend button group |
| r12 (`r12_1`, `r12_2`, `r12_3`) | `str` (python code) | generated code, model-repaired code, code after human-selected hunks | session state `backend/server.py` |
| r17 | `number` | improvement r16.score − r14.score | `backend/pipeline_repair.py` |
| r18 | `Hunk[]` | unified diff hunks between r12_1 and r12_2 | `backend/diffing.py` |
| r19 | `int[]` | ids of hunks the human ticked | frontend |
| r20 | `str` (SVG) | final exported vector chart | `backend/render.py` |

## Transformations

| process | step | actor/op | function | file |
| --- | --- | --- | --- | --- |
| 1 | r1_1 → r2_1 | tool_1 execute | `render.execute_code` | render.py |
| 1 | r2_1 → r3_1 | tool_2 evaluate | `metrics.evaluate_rendering` | metrics.py |
| 1 | r1_1 → r1_2 | tool_3 modify | `mutations.apply_operator` (deterministic edit operators) | mutations.py |
| 1 | r1_2 → r4_1 | tool_1 execute | `render.execute_code` | render.py |
| 1 | r4_1 → r5_1 | tool_2 evaluate | `metrics.evaluate_rendering` | metrics.py |
| 1 | r3+r5 → r6 | tool_4 evaluate | `pipeline_train.score_deltas` | pipeline_train.py |
| 1 | → r7 | tool_4 compose | `pipeline_train.compose_records` | pipeline_train.py |
| 1 | r7 → r8 | tool_4 select | `pipeline_train.select_records` | pipeline_train.py |
| 1 | r8 → r9 | model_2 train | `repair_model.train` (ridge regression of delta on metric features, one row per operator) | repair_model.py |
| 2 | r10+r11 → r12_1 | model_1 generate ~ | `llm.call_model` with GENERATE prompt | llm.py, pipeline_generate.py |
| 3 | r12_1 → r13 | tool_1 execute | `render.execute_code` | render.py |
| 3 | r13 → r14 | tool_2 evaluate | `metrics.evaluate_rendering` | metrics.py |
| 3 | r12_1+r9+r14 → r12_2 | model_2 modify ~ | `repair_model.predict` + `llm.call_model` with REPAIR prompt | repair_model.py, pipeline_repair.py |
| 3 | r12_2 → r15 → r16 | tool_1 execute, tool_2 evaluate | as above | |
| 3 | r14+r16 → r17 | tool_5 evaluate | `pipeline_repair.improvement` | pipeline_repair.py |
| 3 | r12_1+r12_2 → r18 | tool_5 extract | `diffing.extract_hunks` | diffing.py |
| 3 | r18 → r19 | human select | hunk checkboxes in Repair view | frontend/app.js |
| 3 | r12_1+r18+r19 → r12_3 | tool_5 modify | `diffing.apply_hunks` | diffing.py |
| 4 | r12_3 → r20 | tool_5 translate | `render.translate_to_svg` | render.py |

## Open choices and defaults taken

* Stack: Python 3 stdlib `http.server` backend (matplotlib + numpy already installed; no new deps), vanilla HTML/JS frontend.
* Model provider: Claude Code CLI (`claude -p --output-format json`, CLAUDECODE removed) behind `llm.call_model`.
* model_2 "train": the CLI cannot be fine-tuned, so model_2 is a two-part model: a numeric weight matrix (r9) trained locally by ridge regression, plus an LLM configuration that is conditioned on the predicted operator gains when it modifies code. Documented in NOTES.md.
* Persistence: JSON files in `data/` (weights, training records); session state in memory.
* Layout: two tabs — "Train repair model" (process 1) and "Create chart" (processes 2→3→4 as a vertical flow).
* No steps added beyond the design.
