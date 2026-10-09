# System X — learned chart repair

Implementation of the Human-AI grammar design in `design.json`. Chart programs (matplotlib) are
executed, scored with readability metrics, and repaired by a model whose edit priorities are learned
from a corpus; the user reviews the repair hunk by hunk and exports the final chart.

## Run

Requirements: Python 3.10+ with `matplotlib` and `numpy`, and the Claude Code CLI (`claude`) on PATH.

```bash
python3 backend/server.py          # http://127.0.0.1:8811  (PORT env or first arg to change)
python3 -m unittest discover -s tests   # unit tests (no model calls)
python3 tests/e2e.py                # walks all four processes against a running server (calls the model)
```

1. **Train repair model** tab → *Build training data & train* (process 1, ~5 s).
2. **Create chart** tab → write a request, pick a chart type, *Generate & repair* (processes 2 and 3).
3. Tick the changes to keep → *Apply selected changes* (end of process 3, then process 4).

All model calls go through `backend/llm.py:call_model` (Claude Code CLI, `claude -p --output-format json`,
CLAUDECODE removed from the environment). Replace that one function to change provider.

## Design → code

| Process | Step | Code |
| --- | --- | --- |
| 1 | `(r1_1)*` corpus | `backend/corpus.py`, `backend/seed_corpus/` |
| 1 | `[tool_1 execute]` r1_1 → r2_1, r1_2 → r4_1 | `render.execute_many` → `render_worker.py` |
| 1 | `[tool_2 evaluate]` → r3_1, r5_1 | `metrics.evaluate_rendering` |
| 1 | `[tool_3 modify]` r1_1 → r1_2 | `mutations.apply_operator` |
| 1 | `[tool_4 evaluate]` → r6_1 | `pipeline_train.score_deltas` |
| 1 | `[tool_4 compose]` → r7_1 | `pipeline_train.compose_records` |
| 1 | `[tool_4 select]` → r8_1 | `pipeline_train.select_records` |
| 1 | `[model_2 train]` → r9_1 | `repair_model.train` (weights in `data/weights.json`) |
| 2 | `[model_1 generate]~` r10 + r11 → r12_1 | `pipeline_generate.generate` (prompt: `build_generate_prompt`) |
| 3 | `[tool_1 execute]` → r13_1, r15_1 | `render.execute_code` |
| 3 | `[tool_2 evaluate]` → r14_1, r16_1 | `metrics.evaluate_rendering` |
| 3 | `[model_2 modify]~` r12_1 + r9_1 + r14_1 → r12_2 | `pipeline_repair.model_modify`, `repair_model.predict`, `repair_model.build_modify_prompt` |
| 3 | `[tool_5 evaluate]` → r17_1 | `pipeline_repair.improvement` |
| 3 | `[tool_5 extract]` → r18_1 | `diffing.extract_hunks` |
| 3 | `[human select]` → r19_1 | hunk checkboxes, `frontend/app.js:renderHunks` |
| 3 | `[tool_5 modify]` → r12_3 | `diffing.apply_hunks` via `pipeline_repair.apply_selection` |
| 4 | `[tool_5 translate]` r12_3 → r20_1 | `pipeline_repair.translate` → `render.translate_to_svg` |

HTTP glue: `backend/server.py` (`/api/train`, `/api/create`, `/api/apply`, `/api/jobs/<id>`).
