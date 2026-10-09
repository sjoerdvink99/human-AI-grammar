# NOTES — decisions the design did not determine

The design gives five process expressions and nothing else: no goal, no system description, no
process descriptions, no representation descriptions, no references, no images. Everything below
except the steps themselves and their order was my choice.

## Interpretation of the whole system

| Open question | Choice |
| --- | --- |
| What the system is for | Semantic profiling of a collection of relational tables (a "data lake"): column semantic types, keys, FKs, FDs and table roles, combined into one inspectable, editable profile. Inferred from identifiers (`detected_features`, `rule_taxonomies`, `key_relations`, `functional_dependencies`, `table_types`). |
| How processes connect / are triggered | One app with three tabs. "Profile tables" runs process 1 and then process 2 automatically. Process 3 runs on every click on a profile element. Process 4 runs on "Apply edits". Process 5 runs on "Train classifier". |
| Process 5 starting state | Uses `column_semantics_1`, `table_labels_1`, `table_types_1` from process 2 literally, not the refined types from process 4. |
| Process 4 versions | Every application of edits creates a new profile version (v2, v3, …) from the version currently shown; all versions are kept, can be switched in the sidebar, and changes vs the parent are marked in the views. |
| Effect of training | The trained classifier is persisted and included in every later `[model_2 assign]` prompt (processes 2 and 4). "Re-profile with updated classifier" re-runs process 2. |

## Representations: contents and formats

| Identifier | Choice |
| --- | --- |
| tables | CSV files loaded into an in-memory DuckDB database (`read_csv_auto`, full-file type sniffing). Table names are sanitized file names. |
| samples | Reservoir sample of 30 rows per table (seed 42), stored with DuckDB `rowid` and the round in which each row was added. |
| detected_features | Seven feature kinds per column: `not_null`, `unique` (needs ≥10 sample values), `type` (integer/decimal/date/datetime/boolean/text), `range` (numeric min/max), `pattern` (first matching of uuid, email, url, ISO date, 2- and 3-letter upper-case codes, alphanumeric code, phone), `domain` (≤8 distinct values, ≤30% distinct ratio, ≥10 values), `length` (text without a domain). |
| counterexamples_1 | Up to 5 violating full-table rows per feature; for range and length the most extreme violations on both sides, so a single expansion fixes the bound. |
| expand loop | Adds counterexample rows to the samples and re-extracts all features; stops when no counterexamples remain, nothing new was added, or after 4 rounds. |
| column_attributes | count, nulls, distinct, distinct ratio, min, max, mean, average length, top-5 values, 8 sample values, and the features that hold. |
| semantic type taxonomy | 27 fixed types (identifier, person_name, entity_name, email, phone, url, address, city, country, country_code, currency_code, postal_code, date, datetime, year, currency_amount, quantity, percentage, measure, latitude, longitude, category, status, boolean, code, description, unknown). |
| rule_taxonomies | Hand-written rules over patterns, types, domains and column-name tokens. Each rule is marked `strong` (validated pattern/type) or `weak` (name-based). |
| column_semantics composition | When rule and model agree → "agree"; otherwise a strong rule wins; otherwise the model wins unless it says `unknown`. Rule label, model label, confidence and rationale are all kept. |
| key_relations | Candidate keys = unique, non-null, non-decimal columns. Primary key ranking: name `id` / `<table>_id`, then identifier type, then other key-like types. FKs: inclusion of distinct values in another table's PK (≤1% orphans), gated by a name hint (column name equals the PK or contains the target table's stem) or a matching typed code (country_code etc.). Surrogate integer identifiers alone are not enough, which avoids accidental id overlaps. |
| functional_dependencies | Exact single-column FDs X → Y within a table; X excludes keys, near-keys (distinct ratio > 0.9), measures, dates and free text; nulls are treated as one value. |
| table type taxonomy | fact, dimension, bridge, lookup, event_log, other. |
| table_labels rules | bridge (≥2 FKs, ≤1 other column), fact (≥2 FKs + measures, or ≥1 FK + measures), event_log (FK + time + status, not referenced), lookup (referenced, ≤3 columns, no FKs), dimension (referenced), else other. The label carries its evidence: table-level features. |
| semantic_profile | JSON record: version, parent, note, tables (rows, primary key, candidate keys, rule label + rule, table type + confidence + rationale, columns with semantics), key_relations graph, functional_dependencies graph. |
| selected_feature | One of: `column_type`, `primary_key`, `foreign_key`, `fd`, `feature` (a detected feature shown on a column). |
| validation_queries | Exactly two SQL queries per selection: support and counter. Semantic types map to fixed SQL checks (for example email regex, TRY_CAST to DATE, ranges for latitude, longitude and percentage, frequency ≥2 for category and status). |
| supporting_samples / counterexamples_2 | Total count plus the first 20 rows of each query. |
| updated_table_classifier | A decision tree (flat node list: internal nodes feature/op/threshold/yes/no, leaves label) over 10 table-level features, plus all labelled examples, the per-example predictions and the training accuracy. It is a graph, matching the design's medium. |

## Model steps

| Step | Choice |
| --- | --- |
| Provider | `claude -p --output-format json --tools "" --json-schema <schema> [--model sonnet] --append-system-prompt …`, prompt on stdin, `CLAUDECODE` removed, run in the temp dir. One function: `backend/llm.py::call_model`. Reads `structured_output`, falling back to parsing JSON from `result`. |
| model_1 assign | One batched call (chunks of 40 columns). Prompt: taxonomy with definitions, then one JSON line per column with stats, samples, validated features and the rule label. Asks for type, confidence and a one-sentence rationale. The output is validated against the taxonomy, and missing or invalid answers become `unknown` and are marked invalid. |
| model_2 assign | One call for all tables. Prompt: table types with definitions, then per table its column types, PK, FKs, referenced-by, FDs (max 15), rule label and features. Following the design state, it gets no raw rows. If a classifier is trained, its tree and up to 40 examples are added as "learned policy". Invalid answers fall back to the rule label with confidence 0. |
| model_2 train | "Training" a model through a CLI is not possible, so model_2 induces a depth-≤4 decision tree from all accumulated human-labelled examples (and revises the previous tree). The tree is validated in code (known features, operators, labels, no dangling branches or cycles), with one retry that feeds back the error. Training accuracy is computed in code. Examples accumulate across sessions in `data/classifier.json`. |
| `~` handling | Blocking request with a modal progress log (server-side step log, polled every 600 ms), schema-constrained output and validation. The model's output is shown with confidence and rationale, and source colours (agree, rule, model, human) make it reviewable. No streaming. |

## Stack, layout, styling, interaction

- **Stack:** Python stdlib `http.server` plus DuckDB (the only dependency), and vanilla JS ES modules with hand-drawn SVG. No build step, no framework. The page reads its whole state from one `/api/state` call.
- **Persistence:** session state lives in memory, so restarting the server clears it. Only the classifier is persisted. Uploaded CSVs are written to `data/uploads/`.
- **Demo data:** a generated e-commerce lake (countries, categories, customers, products, orders, order_items) with planted dirt: 2 malformed emails, 1 missing city, 1 outlier price and 1 unusual status. The dirt makes the sampling loop and the validation drawer show something.
- **Layout:** a dark header with tabs ("1 · Sampling & features", "2–4 · Semantic profile", "5 · Table-type training"), a left sidebar (tables, upload, profile versions, a pipeline checklist naming every design step and whether it has run), the main view, and a right drawer for the validation view.
- **Schema graph:** layered left-to-right by FK depth (tables that reference others on the left). Boxes are coloured by table type and show the confidence. Column rows carry PK/FK markers and a semantic-type chip coloured by source. FKs are curves with arrowheads, dashed when approximate and orange when added by a person. Tooltips show the rule and the model rationale.
- **Table cards** under the graph: type badge, model_2 rationale, rule label and rule, PK, FK and FD chips, and a column table (semantic type, rule type, model_1 type and confidence, clickable feature chips).
- **Selecting (process 3):** clicking anything in the graph or the cards opens the drawer. It shows a verdict, a support/counter bar, both SQL queries with simple syntax highlighting, and counterexamples and supporting rows with the involved columns highlighted.
- **Editing (process 4):** a toggle mode with dropdowns for semantic types and PK, add/remove for FKs and FDs, and Apply/Cancel. Changes against the parent version are marked (dashed chip outline, "was X").
- **Training (process 5):** a table of tables with the rule label, the model_2 type and a "your label" select ("corrected"/"confirmed" pill), Train / Re-profile / Reset buttons, the tree drawn as a node-link diagram, and the examples table with tree predictions.
- **Colours:** fact red, dimension blue, bridge purple, lookup green, event_log orange, other grey. Sources: agree green, rule blue, model purple, human orange.

## Deviations / things to know

- No steps were added to the design. Loading/uploading tables and switching or reverting profile versions are UI plumbing, not transformations.
- `[tool_2 translate]` (rendering) runs in the browser rather than on the server, because it is deterministic view code.
- The `feature` selection kind lets process 3 validate the detected features shown in the profile view, using the same SQL as process 1's evaluate step.

## Did the design remind me of a specific published system?

Not of one system I can name with confidence. The design anonymizes the name ("System X") and gives no
description, and I did not look anything up. Parts of it did remind me of published work I know, and
several choices came from that knowledge rather than from the design:

- **The sample → validate → add counterexamples → re-sample loop** (process 1) reminded me of hybrid dependency discovery such as **HyFD** (Papenbrock & Naumann), which alternates sampling-based discovery with full validation and feeds violations back into the sampling. Reading `expand` as "add the violating rows to the sample and re-extract" came from that analogy.
- **Rule-based plus learned semantic column typing** (process 2, model_1) reminded me of **Sherlock / Sato**-style semantic type detection. My taxonomy is a short hand-made list in that spirit, not theirs.
- **Classifying tables as fact / dimension (and joins via key relations)** reminded me of **Auto-BI** (automatically building BI models with fact/dimension and join prediction). The fact/dimension/bridge/lookup taxonomy and the star-schema reading of `table_types` came from that and from general data-warehousing knowledge.
- **Inclusion-dependency-based foreign key discovery** and single-column FD checks are standard data-profiling techniques (Metanome-style). The specific thresholds and name-hint gating are mine.

Not from any reference: the visual design, the SQL validation drawer, the version history, the decision-tree form of the "trained" classifier (a consequence of having only a CLI model), the demo data, and all prompts.
