# NOTES — decisions the design did not determine

`design.json` has only typed expressions. There is no goal, no description for the system or any process, no representation descriptions, no references and no images. Identifiers are opaque (`r1` … `r22`), so **almost everything about meaning is my decision**. The structure the design does fix (actors, operations, media, roles, collections, versions, the one loop and the process connections) is kept exactly.

## Meaning of the system and of each representation

| Item | Design says | I chose |
|---|---|---|
| Domain | tabular collection → records → labels → graphs → record → visual | Inferring a **relational data model (ER schema) from a set of CSV tables** |
| r1 | `artifact tabular *` | Uploaded CSV tables |
| r2 | `artifact tabular *` from `tool select` | Seeded random row samples, one per table |
| r3 | `artifact record *` from `tool extract` | Per-column profile (dtype, null %, distinct %, examples, min/max) |
| r4 | `artifact tabular` from `tool evaluate`, later r4_2 from `tool execute` | v1: a sample-adequacy table (is each column's uniqueness settled at this sample size?). v2: a table of SQL check statistics (row counts, orphans, duplicates) for the selected element |
| P1 loop (`tool expand`) | returns to (r1, r2) | Double the sample of every table that still has "undecided" columns (unique in the sample but not fully read). A check in code stops when all columns are settled, with a cap of 10 rounds. Every round is shown in a table |
| r5 | `artifact record *` | Column feature records (types, uniqueness on the full table, name heuristics) |
| r6 | `label categorical *`, tool | Primitive data type: integer, float, text, date or boolean |
| r7 | `label categorical *`, model_1 | Semantic type: identifier, code, name, category, measure, timestamp, free_text or other |
| r8 | `artifact record *` | r5 + r6 + r7 composed into one record per column |
| r9 | `artifact graph` | Column→column inclusion dependencies (≥95 % of distinct values contained in a unique column of another table), with a "name-supported" flag |
| r10 | `artifact graph` | Table→table graph collapsed from r9 |
| r11 | `label categorical *`, tool | Rule-based key role: primary_key, foreign_key or attribute |
| r12 | `label categorical *`, model_2 | Key role predicted by the classifier, with a confidence |
| r13 | `artifact record` | Data model: entities (name, editable label, primary key, annotated columns) and relationships (from/to column, cardinality, coverage) |
| r14 / r21 | `artifact visual` | SVG ER diagram with PK/FK badges and crow's-foot style ends |
| r15 | `selection record` | `{kind: entity or relationship, id, column?}` |
| r16 | `artifact formal *` | SQL statements (2–5 per selection), shown with simple highlighting |
| r17 | `artifact tabular` | Label/value result of the one "result" query |
| r18 | `artifact visual` | Horizontal bar chart |
| r19 | `label categorical *`, tool, after the human edit | Key roles implied by the edited model, plus each relationship's cardinality |
| r20 | `label categorical *`, model_2 | Classifier key roles recomputed on the edited model. Disagreements with r19 are shown as ⚠ in the diagram and listed |
| r22 | `artifact graph` from `model_2 train` | The fitted decision tree as nodes and links, drawn top-down |

## Actors

* **model_1** is the only language-model call. It is one batched prompt that labels every column's semantic type and replies in JSON. Its output is checked against the fixed label set where r7 is produced. Invalid or missing labels are replaced by a rule-based fallback, which is listed in the API response and shown in the UI.
* **model_2** is a scikit-learn `DecisionTreeClassifier` (max_depth 4). The design has it `assign` and `train`, and its trained output is a `graph`, which pointed to a learned, inspectable model rather than an LLM.
* **Bootstrapping model_2**: the design does not say how model_2 exists before process 5 runs. I fit it on the rule labels r11 the first time process 2 runs. After that, process 5 refits it on the human-corrected r12_2, and later process 4 edits use the refitted tree.
* Classifier features: the type flags, distinct and null ratios, full-table uniqueness, name heuristics, semantic-type one-hots taken from r7, and in/out degree over the name-supported r9 edges (recomputed from the relationships in process 4).
* **tool_1** is Python on the backend (pandas, sqlite3). **tool_2** is the browser renderer (`render.js`). I read the separate tool instance as "the visual renderer".

## Process wiring and triggers

* Loading tables runs process 1 and then process 2 automatically. Neither has a human step, and P2 continues from P1. "Profile & build model" re-runs both, for example with a different initial sample size.
* If process 2 is re-run on unchanged inputs, r7 is carried forward (the same identifier and version), not requested from the model again.
* Process 3 is triggered by clicking an entity header, a column row (which charts that column) or a relationship line. Entity → row count, duplicate PK and null PK checks, and a value distribution chart. Relationship → child rows, orphans, childless parents, max fan-out, and a fan-out histogram chart.
* Process 4: an editor panel works on a draft copy (entity labels, primary key per entity, delete/add relationships) and commits with "Apply edits". Edits are validated on the server: entities can't be added or removed, and only known columns can be referenced. Every r13 version is kept, and any version can be restored, which creates a new version.
* Process 5: the classifier labels in the column table are editable dropdowns. "Retrain" sends the full r12_2 collection. After retraining, the corrected labels become the shown r12. The diagram is not redrawn, because the design ends process 5 at r22.

## Stack, layout, styling and data formats

* Stack: FastAPI + pandas + scikit-learn + sqlite3 (in memory). The frontend is plain HTML, CSS and ES modules with hand-written SVG: no build step, no CDN, no chart library.
* Persistence: one in-memory workspace per server process. `/api/state` restores the UI after a page reload.
* Model provider: `backend/model_provider.py:call_model` runs `claude -p <prompt> --output-format json` with `CLAUDECODE` removed, reads `result` from the JSON envelope, and pulls the first JSON object out of the reply (`call_model_json`). There is a 180 s timeout.
* Layout: three tabs ("Tables & profiling", "Data model", "Columns & classifier"). The Data model tab has the diagram on the left, with drag-to-move entity boxes on a dotted canvas and a grid start layout. The side panel on the right has "Explore selection" (P3) and "Edit model" (P4) sub-tabs. The intermediate graphs r9 and r10 are listed in a collapsible section under the diagram.
* Styling: neutral slate and blue palette. PK is amber, FK is teal, warnings are orange.
* Data input: CSV files only, and the table name is the file name.
* Sample data: a generated four-table shop dataset (customers, orders, order_items, products) in `sample_data/`.
* Thresholds: initial sample 50 rows (editable), inclusion coverage ≥ 0.95, tree depth ≤ 4.
* Tests: `tests/test_processes.py` covers all five processes through the API, with model_1 stubbed, plus a model-failure fallback test.

## Verification

* `pytest`: 6 passed.
* Headless-browser walk-through (Playwright): load the sample → P1 rounds → P2 diagram (live Claude call, 4 entities and 3 relationships found) → click a relationship (P3: SQL, checks, chart) → delete a relationship and apply (P4: v2 with a ⚠ disagreement) → correct a label and retrain (P5: tree v2). There were no console errors. Every transformation in the design was reachable.

## Did the design remind me of a published system?

Not of one specific system with confidence. The opaque design had no names or text. The structure reminded me of work on **automatic join and schema discovery for BI models**, most closely Microsoft's **Auto-BI** (He et al., VLDB 2023). Auto-BI predicts joins between tables with a local classifier and then assembles a global schema graph into a snowflake-like BI model. The design also reminded me of the general data-profiling literature on inclusion-dependency discovery. I am not sure it is either.

These choices came from that background knowledge rather than from the design:

* reading the whole system as "infer keys and relationships between tables" (the design only gives media and roles);
* r9 as inclusion dependencies between columns, r10 as a table-level schema graph, and the ≥95 % containment threshold;
* key roles (PK, FK, attribute) and N:1 or 1:1 cardinalities as the label sets for r11, r12, r19 and r20;
* r4 in process 1 as sample adequacy for uniqueness, and the expand-until-settled loop (a common sampling-based profiling pattern);
* a decision tree for model_2, chosen because it can be trained quickly on a few corrected labels and exported as a graph. This came from general ML practice, not from a specific paper.
