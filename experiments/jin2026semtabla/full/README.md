# System X — semantic enrichment of data tables

Upload a set of CSV tables (or load the demo database). System X finds column semantics, keys,
foreign keys, functional dependencies and table types. You explore the results in linked views,
check the supporting and contradicting records for anything it inferred, and correct it. Table-type
corrections retrain the decision-tree classifier.

Built from the Human-AI grammar design in [`design.json`](design.json). See [PLAN.md](PLAN.md) and [NOTES.md](NOTES.md).

## Run

```sh
./run.sh                 # creates .venv, installs requirements, serves http://127.0.0.1:8000
.venv/bin/python -m pytest -q tests
```

Requires Python 3.11+ and, for model_1, the `claude` CLI on `PATH` (called as
`claude -p --output-format json` with `CLAUDECODE` removed from the environment). To use another
provider, change `backend/llm.py::call_model`. If the CLI fails, the affected columns are
marked `other` with the error shown, and the rest of the pipeline keeps running.

Using it: click **Load demo database** → **Run all**, or run the steps in the top bar one at a time.
Then click columns, **PK** badges, relationship arrows, dependency arcs or tables.

## Design → code map

| Process | Grammar step | Implementation |
| --- | --- | --- |
| 1 Counterexample-Guided Feature Detection | `[tool_1 select]` tables → samples | `backend/detection.py::select_samples` (+ `complete_references`) |
| | `[tool_1 extract]` → detected_features | `detection.py::extract_features` |
| | `[tool_1 evaluate]` → counterexamples_1 | `detection.py::evaluate_features` / `violation_sql` |
| | `[tool_1 expand]` → samples (loop) | `detection.py::expand_samples`; loop in `run_detection` (stops at 0 counterexamples or max iterations) |
| 2 Semantic Enrichment and Table Profiling | `[tool_1 extract]` → column_attributes | `backend/enrichment.py::extract_column_attributes` (stage 2a) |
| | `[tool_1 assign]` → rule_taxonomies | `backend/taxonomy.py::assign_rule_taxonomies` |
| | `[model_1 assign]` → predicted_taxonomies | `taxonomy.py::predict_taxonomies` → `backend/llm.py::call_model` |
| | `[tool_1 compose]` → column_semantics | `enrichment.py::compose_column_semantics` |
| | `[tool_1 extract]` → key_relations | `enrichment.py::extract_key_relations` (stage 2b) |
| | `[tool_1 extract]` → functional_dependencies | `enrichment.py::extract_functional_dependencies` (stage 2c) |
| | `[tool_1 assign]` → table_labels | `backend/table_classifier.py::assign_table_labels` (stage 2d) |
| | `[model_2 assign]` → table_types | `table_classifier.py::TableClassifier.predict` (decision tree) |
| | `[tool_1 compose]` → semantic_profile | `enrichment.py::compose_profile` |
| | `[tool_2 translate]` → semantic_views | `frontend/views.js::renderSemanticViews` (schema graph, taxonomy bars, column grid, FD arcs) |
| 3 Inspect Semantic Evidence | `[human select]` → selected_feature | clicks in the views → `frontend/app.js::setSelection` |
| | `[tool_1 translate]` → validation_queries | `backend/validation.py::build_queries` |
| | `[tool_1 execute]` → supporting_samples + counterexamples_2 | `validation.py::execute_queries` |
| | `[tool_2 translate]` → validation_view | `frontend/views.js::renderValidationView` |
| 4 Refine Inferred Semantics | `[human modify]` → semantic_profile_2 | inspector edit controls → `backend/refine.py::apply_edits` |
| | `[tool_1 assign]` → refined_table_labels | `refine.py::refine` → `assign_table_labels` |
| | `[model_2 assign]` → refined_table_types | `refine.py::refine` → `TableClassifier.predict` |
| | `[tool_2 translate]` → updated_semantic_views | re-render after `/api/refine` |
| 5 Update Table Classifier from Corrections | `[human modify]` → table_types_2 | table inspector “Correct the table type” → `refine.py::correct_table_type` |
| | `[model_2 train]` → updated_table_classifier | `TableClassifier.train_with_correction` → tree shown in the “Table classifier” tab |

HTTP API (`backend/app.py`): `POST /api/demo`, `POST /api/upload`, `POST /api/detect`,
`POST /api/enrich/{attributes|keys|dependencies|tables}`, `POST /api/inspect`, `POST /api/refine`,
`POST /api/table-type`, `POST /api/classifier/reset`, `GET /api/state`, `GET /api/samples/{table}`.
