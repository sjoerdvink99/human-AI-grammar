# System X — tables → data model

This app is built from `design.json`. You load a set of CSV tables and it profiles them on growing samples. It then infers column types and key roles (rules, a language model, and a trainable decision tree) and composes an entity–relationship data model, drawn as a diagram. From there you can:

* click parts of the diagram to run SQL checks and see charts,
* edit the model and see it re-labelled,
* correct the classifier's labels and retrain it.

## Run

```bash
uv venv .venv && uv pip install --python .venv -r requirements.txt
.venv/bin/uvicorn backend.app:app --port 8000
# open http://localhost:8000 and click "Load sample tables" (or upload CSVs)
.venv/bin/python -m pytest -q          # tests (the language model is stubbed)
```

The language-model step calls the local Claude Code CLI (`claude -p --output-format json`, with `CLAUDECODE` removed from the environment). This happens in `backend/model_provider.py:call_model`. If the CLI is missing or fails, rule-based labels are used and the UI says so.

## Design → code

| Process | Step | Code |
|---|---|---|
| 1 | `[tool_1 select]` r1 → r2 samples | `backend/profiling.py:select_samples` |
| 1 | `[tool_1 extract]` → r3 profiles | `profiling.py:extract_profiles` |
| 1 | `[tool_1 evaluate]` → r4 sample adequacy | `profiling.py:evaluate_samples` |
| 1 | `[tool_1 expand]` → back to (r1, r2) | `profiling.py:expand_samples`; the loop and its check are in `run_profiling` |
| 2 | `[tool_1 extract]` → r5 features | `backend/modeling.py:extract_features` |
| 2 | `[tool_1 assign]` → r6 data types | `modeling.py:assign_data_types` |
| 2 | `[model_1 assign]` → r7 semantic types | `modeling.py:assign_semantic_types` → `model_provider.py:call_model` |
| 2 | `[tool_1 compose]` → r8 annotated columns | `modeling.py:compose_columns` |
| 2 | `[tool_1 extract]` → r9 inclusion graph | `modeling.py:extract_inclusion_graph` |
| 2 | `[tool_1 extract]` → r10 table graph | `modeling.py:extract_table_graph` |
| 2 | `[tool_1 assign]` → r11 rule key roles | `modeling.py:assign_rule_keys` |
| 2 | `[model_2 assign]` → r12 classifier key roles | `backend/classifier.py:KeyClassifier.predict` |
| 2 | `[tool_1 compose]` → r13 data model | `modeling.py:compose_data_model` |
| 2 | `[tool_2 translate]` → r14 diagram | `frontend/render.js:renderDiagram` |
| 3 | `[human select]` → r15 selection | clicking in the diagram, `frontend/app.js:select` |
| 3 | `[tool_1 translate]` → r16 SQL | `backend/query.py:selection_to_sql` |
| 3 | `[tool_1 execute]` → r17 result + r4_2 checks | `query.py:execute_queries` (in-memory sqlite) |
| 3 | `[tool_2 translate]` → r18 chart | `render.js:renderChart` |
| 4 | `[human modify]` → r13_2 | "Edit model" panel, `app.js:renderEditor` / `applyEdits` |
| 4 | `[tool_1 assign]` → r19 | `modeling.py:assign_rule_keys_for_model` |
| 4 | `[model_2 assign]` → r20 | `KeyClassifier.predict` on `modeling.py:model_columns` |
| 4 | `[tool_2 translate]` → r21 | `renderDiagram` (⚠ marks where r20 disagrees with r19) |
| 5 | `[human modify]` → r12_2 | editable label column on the "Columns & classifier" tab |
| 5 | `[model_2 train]` → r22 tree | `KeyClassifier.train` / `as_graph`, drawn by `render.js:renderTree` |

API endpoints: `/api/process1` … `/api/process5` (see `backend/app.py`). The plan is in `PLAN.md`, and the design decisions are in `NOTES.md`.
