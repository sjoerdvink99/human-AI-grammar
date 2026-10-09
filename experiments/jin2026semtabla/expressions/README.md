# System X — semantic table profiler

A web application built from the Human-AI grammar design in [`design.json`](design.json).
It profiles a collection of tables: it learns column features from samples (and grows the samples
with counterexamples until the features hold), labels columns with semantic types (rules + model_1),
discovers keys, foreign keys and functional dependencies, classifies tables (rules + model_2), shows
the resulting **semantic profile** as a schema graph, and lets a person validate any part of it with
SQL, edit it, and retrain the table classifier on corrected labels.

## Run

```bash
pip install -r requirements.txt          # only DuckDB; the server uses the Python stdlib
python3 scripts/make_sample_data.py      # (optional) regenerate the demo data lake in data/sample/
python3 backend/server.py                # http://localhost:8000
```

Then click **Load sample lake** (or upload CSVs) and **Profile tables**.

Model steps call the local Claude Code CLI (`claude -p --output-format json --json-schema …`, with
`CLAUDECODE` removed from the environment). Set `SYSTEMX_MODEL` (default `sonnet`) or
`SYSTEMX_MODEL_TIMEOUT` (seconds) to tune it. To use another provider, replace
`call_model()` in [`backend/llm.py`](backend/llm.py) — it is the only place a model is called.

Tests for the deterministic steps: `python3 -m unittest discover -s tests`.

## Design → code

| Process | Transformation | Implementation |
| --- | --- | --- |
| 1 | `[tool_1 select]` tables → samples | `select_samples` — [backend/p1_sampling.py](backend/p1_sampling.py) |
| 1 | `[tool_1 extract]` samples → detected_features | `extract_features` → `detect_column_features` — [backend/features.py](backend/features.py) |
| 1 | `[tool_1 evaluate]` → counterexamples_1 | `evaluate_features` (SQL from `feature_conditions`) — p1_sampling.py |
| 1 | `[tool_1 expand]` → samples (loop) | `expand_samples`; loop in `run_process1` (stops when no counterexamples, or after 4 rounds) |
| 2 | `[tool_1 extract]` → column_attributes | `extract_column_attributes` — [backend/p2_profile.py](backend/p2_profile.py) |
| 2 | `[tool_1 assign]` → rule_taxonomies | `assign_rule_taxonomies` |
| 2 | `[model_1 assign]~` → predicted_taxonomies | `model1_assign_taxonomies` (prompt `_model1_prompt`, schema `MODEL1_SCHEMA`) |
| 2 | `[tool_1 compose]` → column_semantics | `compose_column_semantics` |
| 2 | `[tool_1 extract]` → key_relations | `extract_key_relations` |
| 2 | `[tool_1 extract]` → functional_dependencies | `extract_functional_dependencies` |
| 2 | `[tool_1 assign]` → table_labels | `assign_table_labels` |
| 2 | `[model_2 assign]~` → table_types | `model2_assign_table_types` (prompt `_model2_prompt`, uses the trained classifier) |
| 2 | `[tool_1 compose]` → semantic_profile_1 | `compose_semantic_profile` |
| 2 | `[tool_2 translate]` → semantic_views | `renderSchemaGraph` — [web/views.js](web/views.js); table cards in `renderProfileTab` — [web/app.js](web/app.js) |
| 3 | `[human select]` → selected_feature | clicks on columns / PK / FK edges / FD / feature chips → `actions.select` — app.js |
| 3 | `[tool_1 translate]` → validation_queries | `translate_to_queries` — [backend/p3_validation.py](backend/p3_validation.py) |
| 3 | `[tool_1 execute]` → supporting_samples + counterexamples_2 | `execute_queries` |
| 3 | `[tool_2 translate]` → validation_view | `renderValidationView` — views.js (right drawer) |
| 4 | `[human modify]` → semantic_profile_2 | "Edit profile" mode in `renderProfileTab`; validated by `normalize_edited_profile` — [backend/p4_refine.py](backend/p4_refine.py) |
| 4 | `[tool_1 assign]` → refined_table_labels | `assign_table_labels` via `run_process4` |
| 4 | `[model_2 assign]~` → refined_table_types | `model2_assign_table_types` via `run_process4` |
| 4 | `[tool_2 translate]` → updated_semantic_views | `renderSchemaGraph(…, {compare: parent})` marks changes vs the previous version |
| 5 | `[human modify]` → table_types_2 | "Table-type training" tab selects → `apply_corrections` — [backend/p5_training.py](backend/p5_training.py) |
| 5 | `[model_2 train]` → updated_table_classifier | `train_table_classifier` (model induces a decision tree; validated and scored in code; persisted to `data/classifier.json`); rendered by `renderTree` |

Taxonomies (fixed category sets) are in [backend/taxonomy.py](backend/taxonomy.py); the HTTP API
and session state are in [backend/server.py](backend/server.py). See [PLAN.md](PLAN.md) and
[NOTES.md](NOTES.md) for the plan and every decision the design left open.
