# NOTES — decisions the design did not determine

The design (`design.json`) fixes the five processes, their representations, actors and triggers.
It has no references and no images. Everything below was my choice.

## Stack and libraries
- **Backend:** Python 3.13 with FastAPI and uvicorn. **Data and SQL:** DuckDB, in memory. pandas is used only to build the demo data and to read uploads. **Classifier:** scikit-learn `DecisionTreeClassifier` (entropy criterion, `random_state=0`).
- **Frontend:** no build step. Static HTML, vanilla ES modules and D3 v7 (vendored in `frontend/vendor/`, ISC licence included). FastAPI serves it.
- **Tests:** pytest with FastAPI's TestClient. A stub replaces model_1 (`SYSTEMX_FAKE_MODEL`).
- **Persistence:** the workspace is in memory, single user, and resets when the server restarts. Only the classifier corrections persist, in `data/classifier_corrections.json`, so "future predictions" survive restarts.

## Model steps
- **model_1 (column taxonomy):** one batched call through `backend/llm.py::call_model(system, prompt)`. That function runs `claude -p --output-format json` with `CLAUDECODE` removed and parses the `result` field as JSON (it also handles code fences). To swap providers, change only this function.
  - **Prompt:** the fixed taxonomy (id and description), then a JSON list of the ambiguous columns. Each entry has the key, table, column, the other columns in the table, the type, best pattern and match ratio, uniqueness, null ratio, min/max, and up to 8 distinct sample values. The model must answer `{"columns":[{key, category, confidence, rationale}]}`.
  - **Validation:** a category outside the taxonomy becomes `other` with confidence 0. Confidence is clamped to [0, 1]. Columns missing from the answer, or a CLI failure, become `other` with the error recorded; the UI marks these with "!".
- **model_2 (table type):** this is **not** the Claude CLI. The design calls model_2 a *decision-tree classifier* that is *updated through active learning*, so it is a real trainable decision tree. I read the instruction "implement every model step with the Claude CLI" as covering the language-model steps; this is the one place I departed from it. The tree starts from 24 hand-written seed examples (table labels → type) in `table_classifier.py::SEED`. Each user correction is added with sample weight 3 and the tree is refit.
- **Model scope:** only these two model steps exist. Explanations in process 3 are templated text produced by tool_1, not model output, because the design gives that step to tool_1.

## Data formats and vocabularies
- **Uploads:** CSV only, one file per table; the table name comes from the file name. Each column's type is inferred in this order: BIGINT, DOUBLE, DATE, TIMESTAMP, BOOLEAN, VARCHAR. Codes with leading zeros stay text. Uploading replaces the current database.
- **Detected feature kinds:** `not_null`, `unique` (single column, or column pairs when no single column is unique), `pattern` (the most specific of 12 regex patterns that matches every value), `fd` (single-column LHS → RHS), and `inclusion` (child column ⊆ unique parent column).
- **Inclusion dependency candidates** need a **name link**: same name, `<stem>_id` → `id`, or a suffix match. Without it, unrelated small integers would produce spurious inclusions.
- **Sampling:** a reservoir sample of 200 rows per table (seed 42) by default, with at most 5 iterations; both are editable. I added **join-aware completion**: parent rows referenced by sampled child values are added to the sample, so real foreign keys are not lost to sampling. Without it, sampled order_items referenced orders that were missing from the orders sample, so the true order_items → orders FK disappeared.
- **Counterexample handling:** each refuted feature adds at most 20 witness rows to the samples. Duplicates add two rows per value; FDs add one row per (lhs, rhs) pair. When the loop stops at the iteration limit, features that still have counterexamples are dropped.
- **Column taxonomy:** 21 categories, listed in `taxonomy.py::TAXONOMY`.
- **Rules (tool_1 assign):** boolean, temporal, e-mail and URL by pattern (at least 95% of values); identifier by name plus key-like values. Every other column counts as ambiguous and goes to model_1.
- **Table labels:** 13 binary labels, such as `has_single_key`, `references_many`, `few_rows` and `has_internal_fds`.
- **Table types:** entity, event, bridge, lookup.
- **Primary key choice:** among verified unique, not-null candidates, prefer the fewest columns, then id-like names, identifier taxonomy, integer type, and leftmost position.
- **Foreign keys:** verified inclusions whose target is a candidate key.
- **Functional dependencies:** FDs whose LHS is a key, or whose RHS is part of the primary key, are dropped as trivial.
- **semantic_profile:** a JSON record with `tables[]` (name, rows, primary_key, candidate_keys, labels, type, type_confidence, type_source, type_path), `columns[]` (column attributes plus category, source, confidence and rationale), `foreign_keys[]` and `functional_dependencies[]`. Every refinement pushes a new version (v1, v2, …), which is listed in the sidebar.
- **Demo database:** six tables, generated deterministically, with planted problems: a duplicate e-mail, a duplicate order_ref, 3 orphan customer ids, 2 orphan product ids, a misspelled store city, and 4 null discounts.

## Interaction and triggers
- **Feature detection (process 1)** is the first button in the pipeline bar. The four enrichment stages of process 2 are four further buttons, enabled in order; "Run all" runs all five steps. Re-running detection invalidates the stages.
- **Partial results:** before stage 2d finishes, the views show the results so far. Evidence checks and editing are enabled only once `semantic_profile_1` exists.
- **Process 3 trigger:** selecting a column cell, a PK badge, a relationship arrow or an FD arc runs the validation queries immediately. No separate "check" button.
- **Validation view:** a verdict (supported, or the number of contradicting records), the templated explanation, every SQL query (collapsible, syntax-highlighted), then up to 25 contradicting rows with a reason column and up to 25 supporting rows. The selected columns are shown in bold.
- **Process 4 edits:** set a column's category; set the primary key (single or multiple columns); add or remove a foreign key; add or remove an FD. Each edit applies immediately and creates a new profile version; there is no batch "save". Tables whose type changed get a dashed orange border, and the inspector shows "was X".
- **Process 5:** the "Correct the table type" control in the table inspector. The correction is pinned for this workspace: later predictions, including those in process 4, keep the user's type. It is also shown in the current profile at once, without creating a new version. The "Table classifier" tab draws the retrained tree, highlights the decision path of the selected table, and lists the corrections. "Reset corrections" clears them.
- **Linking between views:** selecting a table highlights it in the schema graph and dims other tables in the column grid and FD view. Hovering a taxonomy bar dims non-matching columns and tables. Selecting an FK or FD outlines it.

## Layout and styling
- **Layout:** three columns: a sidebar (database, detection settings, profile versions), the main area with tabs (Semantic views, Detection log, Data & samples, Table classifier), and an inspector on the right. Pipeline steps sit in a dark top bar.
- **Semantic views:** a 2×2 grid:
  - a force-directed schema graph with rectangle nodes coloured by table type, arrows for FKs, and dashed arrows for user-added FKs;
  - a taxonomy bar chart;
  - a column grid with one row per table and one cell per column, coloured by taxonomy family, with uniqueness and completeness mini-bars, a source mark (R = rule, M = model, ✎ = user) and opacity scaled by model confidence;
  - an arc diagram of FDs per table.
- **Colours:** taxonomy colours are grouped by family (key, contact, geo, time, measure, category, text, other). Table types: entity blue, event orange, bridge purple, lookup green.

## Verification
- `pytest`: 5 end-to-end tests, one per process, all passing.
- I scripted a headless-browser walkthrough with Playwright (installed only in the dev venv): load demo → Run all → inspect a column and an FD → add an FK → inspect it → correct a table type → open the classifier tab. It ran with the real Claude CLI and produced no console errors.

## Did the design remind me of a specific published system?
I could not name one published system that matches the design as a whole: interactive semantic enrichment of a database with linked views, evidence inspection and an actively-learned table classifier. Parts of it reminded me of known work:
- **The counterexample-guided loop (process 1)** looks like hybrid dependency discovery, especially **HyFD** (Papenbrock & Naumann): induce candidates from a sample, validate them on the full data, and feed violations back into the sample. The design specifies this loop itself. From HyFD-style knowledge I took two things: restricting to single-column LHS FDs found on the sample and checked by full-data SQL, and adding the specific witness rows (one row per conflicting value pair) instead of re-sampling at random. The join-aware completion for inclusion dependencies is my own fix, loosely informed by IND-discovery work such as SPIDER/BINDER.
- **The column taxonomy (model_1)** resembles semantic-type detection systems such as **Sherlock** and **Sato**. My category list is my own small, coarser set, not their 78 DBpedia types. Handing the model a column's name, statistics and sample values follows the general idea of those systems.
- **The table types** (entity/event/bridge/lookup) come from general data-warehouse modelling (dimension, fact, bridge and code tables), not from any paper the design points to.
- I did not knowingly copy any layout or visual choice from a specific system.
