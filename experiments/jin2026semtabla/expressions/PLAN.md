# PLAN — System X (semantic profiling of a collection of tables)

The design (`design.json`) has five processes and no goal, descriptions, representation
descriptions, references or images. From the identifiers I read it as: **a data-profiling
tool that takes a set of tables, discovers column features by sampling, labels columns with
semantic types (rules + a model), discovers keys / foreign keys / functional dependencies,
classifies each table (rules + a model), composes a "semantic profile", renders it as views,
and lets a person validate, edit and retrain the table classifier.**

Run mode for this experiment: the plan was not confirmed interactively; every open choice
below uses the recommended default.

## Stack (repository was empty)

| Concern | Choice |
| --- | --- |
| Backend | Python 3 stdlib `http.server` (ThreadingHTTPServer) — no web framework needed |
| Table engine | DuckDB (already installed) — loads CSVs, runs all validation SQL |
| Frontend | One static page, vanilla JS ES modules, hand-written SVG views (no build step) |
| Model provider | `backend/llm.py::call_model()` → `claude -p --output-format json --json-schema … --tools ""`, `CLAUDECODE` removed from env. Swap provider by replacing this one function |
| Persistence | In-memory session state; trained table classifier persisted to `data/classifier.json` |
| Sample data | Generated e-commerce "data lake" (6 CSVs, with a few dirty values) in `data/sample/`; CSV upload also supported |

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| tables | artifact tabular * | DuckDB tables loaded from CSV; `{name, columns, n_rows}` metadata | `backend/store.py` |
| samples | artifact tabular * | per table: sampled rows (with `__rowid`, `__round` added) | `backend/p1_sampling.py` |
| detected_features | artifact record * | `{id, table, column, kind ∈ not_null/unique/type/pattern/range/domain/length, params, description, status, violations}` | `p1_sampling.py` |
| counterexamples (1) | artifact tabular | rows of full tables that violate a sample-derived feature `{round, feature_id, table, column, value, row}` | `p1_sampling.py` |
| column_attributes | artifact record * | per column stats: dtype, count, nulls, distinct, min, max, mean, avg_len, top values, sample values, validated features | `p2_profile.py` |
| rule_taxonomies | label categorical * | rule-assigned semantic type from fixed taxonomy + rule id + strength | `p2_profile.py`, `taxonomy.py` |
| predicted_taxonomies | label categorical * | model_1 semantic type (same taxonomy) + confidence + rationale | `p2_profile.py` |
| column_semantics | artifact record * | merged column type, source (agree/rule/model), both labels | `p2_profile.py` |
| key_relations | artifact graph | nodes = tables/columns; edges = primary keys + inclusion-based foreign keys | `p2_profile.py` |
| functional_dependencies | artifact graph | edges X → Y within a table (exact single-column FDs) | `p2_profile.py` |
| table_labels / refined_table_labels | label categorical * | rule table label ∈ table-type taxonomy, with evidence counts | `p2_profile.py` |
| table_types / refined_table_types | label categorical * | model_2 table type + confidence + rationale | `p2_profile.py` |
| table_types_2 | label categorical * | human-corrected table types | `p5_training.py` |
| semantic_profile (1, 2, …) | artifact record | `{version, tables[{name, n_rows, primary_key, rule_label, table_type, columns[]}], key_relations, functional_dependencies}`; all versions kept | `p2_profile.py`, `p4_refine.py` |
| semantic_views / updated_semantic_views | artifact visual | schema graph SVG + column chips + FD lists | `web/views.js` |
| selected_feature | selection record | `{kind: column_type/primary_key/foreign_key/fd, …refs}` | `web/app.js` |
| validation_queries | artifact formal * | `{name, purpose: support/counter, sql}` | `backend/p3_validation.py` |
| supporting_samples / counterexamples_2 | artifact tabular | query results (rows + counts) | `p3_validation.py` |
| validation_view | artifact visual | drawer with highlighted SQL, support/counter bar, two tables | `web/views.js` |
| updated_table_classifier | artifact graph | decision tree over table-level features + training examples + accuracy | `p5_training.py` |

## Transformations

| Process | Actor op | Function | File |
| --- | --- | --- | --- |
| 1 | tool_1 select | `select_samples` | p1_sampling.py |
| 1 | tool_1 extract | `extract_features` | p1_sampling.py |
| 1 | tool_1 evaluate | `evaluate_features` (SQL on full tables) | p1_sampling.py |
| 1 | tool_1 expand → loop | `expand_samples`; loop in `run_process1` until no counterexamples or 4 rounds | p1_sampling.py |
| 2 | tool_1 extract | `extract_column_attributes` | p2_profile.py |
| 2 | tool_1 assign | `assign_rule_taxonomies` | p2_profile.py |
| 2 | model_1 assign ~ | `model1_assign_taxonomies` (Claude) | p2_profile.py |
| 2 | tool_1 compose | `compose_column_semantics` | p2_profile.py |
| 2 | tool_1 extract | `extract_key_relations` | p2_profile.py |
| 2 | tool_1 extract | `extract_functional_dependencies` | p2_profile.py |
| 2 | tool_1 assign | `assign_table_labels` | p2_profile.py |
| 2 | model_2 assign ~ | `model2_assign_table_types` (Claude, uses trained classifier) | p2_profile.py |
| 2 | tool_1 compose | `compose_semantic_profile` | p2_profile.py |
| 2 | tool_2 translate | `renderSemanticViews` | web/views.js |
| 3 | human select | click a column / PK / FK edge / FD in the views | web/app.js |
| 3 | tool_1 translate | `translate_to_queries` | p3_validation.py |
| 3 | tool_1 execute | `execute_queries` | p3_validation.py |
| 3 | tool_2 translate | `renderValidationView` | web/views.js |
| 4 | human modify | edit mode: change column types, remove/add FKs, remove FDs, "Apply edits" | web/app.js |
| 4 | tool_1 assign | `assign_table_labels` on profile_2 | p4_refine.py |
| 4 | model_2 assign ~ | `model2_assign_table_types` on profile_2 | p4_refine.py |
| 4 | tool_2 translate | `renderSemanticViews` (updated) | web/views.js |
| 5 | human modify | review table: correct each table type | web/app.js |
| 5 | model_2 train | `train_table_classifier` (Claude induces a decision tree; validated & scored in code) | p5_training.py |

## Triggers (no process descriptions in design — chosen defaults)

- Process 1 runs on "Profile tables"; process 2 runs automatically after it.
- Process 3 runs when the user clicks a feature in the views.
- Process 4 runs on "Apply edits" in edit mode; produces a new profile version (revertable).
- Process 5 runs on "Train classifier" after corrections; next model_2 runs use it.

## Images
None in the design.
