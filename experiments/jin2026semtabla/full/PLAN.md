# PLAN — System X (semantic enrichment of uploaded tables)

Design: `design.json` (5 processes, no references, no images). Plan written per the experiment
instructions; recommended defaults were taken without waiting for confirmation.

## Stack (repository was empty)

| Concern | Choice |
| --- | --- |
| Backend | Python 3.13, FastAPI + uvicorn (`backend/`) |
| Data / SQL | DuckDB in-memory database holding the uploaded tables; pandas for profiling |
| model_1 (column taxonomy) | Claude Code CLI (`claude -p --output-format json`, `CLAUDECODE` removed) behind `backend/llm.py::call_model` |
| model_2 (table classifier) | scikit-learn `DecisionTreeClassifier` (the design names a decision tree trained by active learning) |
| Frontend | static HTML + vanilla JS modules + vendored D3 v7, served by FastAPI (`frontend/`) |
| Persistence | workspace in memory (single user); classifier corrections persisted to `data/classifier_corrections.json` |
| Tests | pytest (`tests/`) |

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| tables | `dict[str, DataFrame]` + DuckDB tables | uploaded CSVs (or demo DB) | `backend/store.py` |
| samples | `dict[str, DataFrame]` | per-table random sample + added counterexample rows | `backend/detection.py` |
| detected_features | `list[Feature]` (kind, table, columns, ref, status) | unique / not_null / pattern / fd / inclusion candidates | `backend/detection.py` |
| counterexamples (_1, _2) | `DataFrame` per feature | full-data rows contradicting a feature | `backend/detection.py`, `backend/validation.py` |
| column_attributes | `list[ColumnAttributes]` | dtype, distinct, uniqueness, null ratio, pattern + match ratio, stats, sample values, verified features | `backend/enrichment.py` |
| rule_taxonomies | `dict[col, category or "ambiguous"]` | rule-based category | `backend/taxonomy.py` |
| predicted_taxonomies | `dict[col, {category, confidence, rationale}]` | model_1 output for ambiguous columns, validated against `TAXONOMY` | `backend/taxonomy.py` |
| column_semantics | `list[ColumnSemantics]` | attributes + final category + source (rule/model/user) | `backend/enrichment.py` |
| key_relations | graph `{primary_keys, foreign_keys}` | PK per table, FK edges | `backend/enrichment.py` |
| functional_dependencies | graph `[{table, lhs, rhs}]` | non-trivial single-column FDs | `backend/enrichment.py` |
| table_labels / refined_table_labels | `dict[table, list[label]]` from a fixed label set | rule-derived table labels | `backend/table_classifier.py` |
| table_types / refined_table_types | `dict[table, type]` from `TABLE_TYPES` | decision-tree prediction | `backend/table_classifier.py` |
| semantic_profile (_1, _2) | record, versioned list | everything above | `backend/store.py` |
| semantic_views / updated_semantic_views | D3 views | schema graph, column grid, FD view, taxonomy bars (linked) | `frontend/views.js` |
| selected_feature | record `{kind, table, columns, ...}` | clicked attribute / key / FK / FD | `frontend/app.js` |
| validation_queries | `list[{purpose, sql}]` | SQL tests on full data | `backend/validation.py` |
| supporting_samples | rows | records supporting the property | `backend/validation.py` |
| validation_view | panel | queries + both row sets + explanation | `frontend/views.js` |
| updated_table_classifier | tree graph | retrained decision tree, rendered as a tree | `backend/table_classifier.py`, `frontend/views.js` |

## Transformations

| Process | Step | Function / component |
| --- | --- | --- |
| P1 | [tool_1 select] | `detection.select_samples` |
| P1 | [tool_1 extract] | `detection.extract_features` |
| P1 | [tool_1 evaluate] | `detection.evaluate_features` (DuckDB SQL on full data) |
| P1 | [tool_1 expand] → loop | `detection.expand_samples`; loop in `detection.run_detection` until 0 counterexamples or `max_iterations` |
| P2 | [tool_1 extract] column attributes | `enrichment.extract_column_attributes` (stage 1) |
| P2 | [tool_1 assign] rule taxonomies | `taxonomy.assign_rule_taxonomies` (stage 1) |
| P2 | [model_1 assign] | `taxonomy.predict_taxonomies` → `llm.call_model` (stage 1) |
| P2 | [tool_1 compose] column semantics | `enrichment.compose_column_semantics` (stage 1) |
| P2 | [tool_1 extract] keys | `enrichment.extract_key_relations` (stage 2) |
| P2 | [tool_1 extract] FDs | `enrichment.extract_functional_dependencies` (stage 3) |
| P2 | [tool_1 assign] table labels | `table_classifier.assign_table_labels` (stage 4) |
| P2 | [model_2 assign] | `table_classifier.TableClassifier.predict` (stage 4) |
| P2 | [tool_1 compose] profile | `enrichment.compose_profile` |
| P2 | [tool_2 translate] | `frontend/views.js::renderSemanticViews` |
| P3 | [human select] | click on a column cell, PK badge, FK edge or FD edge |
| P3 | [tool_1 translate] | `validation.build_queries` |
| P3 | [tool_1 execute] | `validation.execute_queries` |
| P3 | [tool_2 translate] | `frontend/views.js::renderValidationView` |
| P4 | [human modify] | edit panel: taxonomy dropdown, PK/FK add/remove, FD remove, table label toggles |
| P4 | [tool_1 assign] | `table_classifier.assign_table_labels` on profile_2 (`refine.apply_edits`) |
| P4 | [model_2 assign] | `TableClassifier.predict` |
| P4 | [tool_2 translate] | re-render views |
| P5 | [human modify] | table-type dropdown in the table inspector |
| P5 | [model_2 train] | `TableClassifier.train_with_correction` → tree graph shown in "Classifier" tab |

## Images
None in the design.

## Open choices and defaults taken
- Sample size 200 rows/table, max 5 detection iterations (both editable in the UI).
- Four enrichment stages as four buttons enabled in order, plus "Run all"; feature detection (P1) runs automatically before stage 1 if not yet run, and can also be run alone.
- Column taxonomy: fixed set of 14 categories (see `backend/taxonomy.py`).
- Table types: entity, event, bridge, lookup.
- Demo database generated deterministically (`backend/demo_data.py`) with planted dirty rows so counterexamples occur.
- Layout: left control/sidebar, central linked views grid, right inspector panel.
