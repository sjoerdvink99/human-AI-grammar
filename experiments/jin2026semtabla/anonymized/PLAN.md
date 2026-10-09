# PLAN — System X

The design has no goal, descriptions, representation texts, references or images.
Only the typed expressions are given. The interpretation below is inferred from
the structure, and I took my own defaults without waiting for confirmation.

## Interpretation

A collection of tables (`r1*`) goes in. The system profiles them using samples
(process 1), works out which columns are keys and how the tables relate, and
composes a **data model** (an entity–relationship schema, `r13`) that it shows
as a diagram (`r14`) (process 2). The user can click part of the diagram to run
queries on the real data and get a chart (process 3). They can also edit the
data model, after which labels are recomputed and the diagram is redrawn
(process 4). Finally, they can correct the key-role classifier's labels, which
retrains that classifier. Its result is a decision tree (`r22`, a graph)
(process 5).

* `model_1` (the only language-model step) = Claude, through the CLI, assigns a **semantic type** to each column.
* `model_2` = a trainable classifier (a scikit-learn decision tree) that assigns a **key role** (`primary_key`, `foreign_key`, `attribute`) to each column. It can `train`, so it has to be a learned model rather than an LLM, and its trained form is a tree (`graph`).
* `tool_1` = deterministic Python (pandas and sqlite3). `tool_2` = the SVG renderer in the browser (diagrams and charts).
* No step is marked `~`, so every model step is classification: the outputs are validated against fixed label sets.

## Representations

| id | type | contents | file |
|---|---|---|---|
| r1 tables | artifact tabular * | uploaded CSV tables (pandas DataFrames, also loaded into sqlite) | backend/state.py |
| r2 samples | artifact tabular * | row samples of each table (size n) | backend/profiling.py |
| r3 profiles | artifact record * | per-column profile: dtype, null ratio, distinct ratio, examples, min/max | backend/profiling.py |
| r4 quality | artifact tabular | per-column sample-adequacy table: sample uniqueness compared with expected, stable flag; v2 = join-check statistics from process 3 | backend/profiling.py, backend/query.py |
| r5 column features | artifact record * | numeric feature vector for each column, extracted from r1 + r3 | backend/modeling.py |
| r6 data types | label categorical * | integer, float, text, date, boolean (rule based) | backend/modeling.py |
| r7 semantic types | label categorical * | identifier, name, category, measure, timestamp, code, free_text, other (Claude) | backend/model_provider.py, backend/modeling.py |
| r8 annotated columns | artifact record * | r5 + r6 + r7 composed into one record per column | backend/modeling.py |
| r9 inclusion graph | artifact graph | column→column edges where the values of A are contained in B (inclusion dependencies) | backend/modeling.py |
| r10 table graph | artifact graph | table→table edges collapsed from r9 | backend/modeling.py |
| r11 rule key labels | label categorical * | rule-based key role per column | backend/modeling.py |
| r12 model key labels | label categorical * | decision-tree key role per column; v2 = human-corrected labels | backend/classifier.py |
| r13 data model | artifact record | entities (table, columns, PK), relationships (from, to, cardinality); v2 = human-edited | backend/modeling.py |
| r14 / r21 diagram | artifact visual | SVG ER diagram | frontend/render.js |
| r15 selection | selection record | {kind: entity or relationship, id} | frontend/app.js |
| r16 queries | artifact formal * | SQL statements generated for the selection | backend/query.py |
| r17 result | artifact tabular | query result rows | backend/query.py |
| r18 chart | artifact visual | SVG bar chart of r17 | frontend/render.js |
| r19 rule labels (edited model) | label categorical * | recomputed rule key roles that respect the edits | backend/modeling.py |
| r20 model labels (edited model) | label categorical * | recomputed decision-tree key roles | backend/classifier.py |
| r22 trained tree | artifact graph | decision tree structure (nodes, splits, leaves) | backend/classifier.py |

## Transformations

| process | step | function | file |
|---|---|---|---|
| P1 | tool select r1→r2 | `select_samples` | profiling.py |
| P1 | tool extract →r3 | `extract_profiles` | profiling.py |
| P1 | tool evaluate →r4 | `evaluate_samples` | profiling.py |
| P1 | tool expand →(r1,r2) loop | `expand_samples`; a check in code loops until stable or the full table is used | profiling.py |
| P2 | tool extract →r5 | `extract_features` | modeling.py |
| P2 | tool assign →r6 | `assign_data_types` | modeling.py |
| P2 | model_1 assign →r7 | `assign_semantic_types` → `call_model` | modeling.py, model_provider.py |
| P2 | tool compose →r8 | `compose_columns` | modeling.py |
| P2 | tool extract →r9 | `extract_inclusion_graph` | modeling.py |
| P2 | tool extract →r10 | `extract_table_graph` | modeling.py |
| P2 | tool assign →r11 | `assign_rule_keys` | modeling.py |
| P2 | model_2 assign →r12 | `KeyClassifier.predict` | classifier.py |
| P2 | tool compose →r13 | `compose_data_model` | modeling.py |
| P2 | tool_2 translate →r14 | `renderDiagram` | frontend/render.js |
| P3 | human select →r15 | click an entity or relationship in the diagram | frontend/app.js |
| P3 | tool translate →r16 | `selection_to_sql` | query.py |
| P3 | tool execute →r17 + r4_2 | `execute_queries` | query.py |
| P3 | tool_2 translate →r18 | `renderChart` | frontend/render.js |
| P4 | human modify →r13_2 | data-model editor (rename, set PK, add or remove relationships) | frontend/app.js |
| P4 | tool assign →r19 | `assign_rule_keys_for_model` | modeling.py |
| P4 | model_2 assign →r20 | `KeyClassifier.predict` | classifier.py |
| P4 | tool_2 translate →r21 | `renderDiagram` | frontend/render.js |
| P5 | human modify →r12_2 | key-role dropdowns in the column table | frontend/app.js |
| P5 | model_2 train →r22 | `KeyClassifier.train` | classifier.py |

## Open choices (defaults taken)

* Stack: FastAPI + pandas + scikit-learn + sqlite3 (in memory) on the backend; a single static page with vanilla JS and hand-written SVG on the frontend (no build step, no CDN).
* Model provider: `claude -p --output-format json`, started with `CLAUDECODE` removed, behind `call_model()` in `backend/model_provider.py`. If the call fails, a rule-based fallback is used and the UI shows that it was used.
* Persistence: in memory, one workspace per server process. The bundled sample dataset can be loaded with one click.
* Layout: a left sidebar for tables and profiling, a central diagram, and a right panel for the selection or the editor. A tab switches to "Columns & classifier".
