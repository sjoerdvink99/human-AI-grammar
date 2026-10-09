# NOTES — decisions the design did not determine

## Platform and stack
- **Notebook environment.** The design describes "an extension for the analysts' notebook environment". I did not build a real Jupyter or VS Code extension. Instead I built a standalone web app that simulates one: an editable notebook on the left and an extension-style side panel on the right. Notebook cells are edited but never executed (no kernel), because the design has no execute step.
- **Stack.** Node 20 with the built-in `http` module and no npm dependencies. The frontend is vanilla ES modules, HTML and CSS with no framework and no build step. Tests use `node --test`, plus a CDP-driven browser walkthrough (`scripts/e2e.mjs`).
- **Model provider.** Every model step calls `callModel()` in `server/llm.js`. It runs `claude -p --output-format json --model sonnet --tools ""` with `CLAUDECODE` removed from the environment, takes the `result` field, extracts JSON from it, validates it, and retries once on failure. Tools are disabled so the CLI acts as a plain completion model. The default model is `sonnet` to keep latency low; `SYSTEMX_MODEL` overrides it.
- **model_1–model_4** are the same underlying model with four separate system prompts and output schemas (`server/pipeline.js`).

## Data formats
- **notebook:** `{cells:[{id, type:'code'|'markdown', source}]}`. Outputs are not modelled because nothing runs.
- **rules:** `{id, title, description, severity:'info'|'warning'|'error', author, origin:'seed'|'proposal', version, updatedAt, editedBy?}`. The design only names description and severity. I added a title for scanning, and a version and author for shared editing.
- **context (tool_1):** `{cellCount, imports[{alias,module}], variables[{name,kind,definedIn,expression}], dataframes[{name,source,columnsUsed}], functions[{name,params,cell}], classes, files, markdownNotes}`. It is produced by a regex and line-based Python parser that reads top-level assignments only. Dataframes are detected from `pd.read_*` and `pd.DataFrame` calls and from method-chain heuristics. Column names come from `x["col"]` subscripts.
- **triggered_rules:** `{ruleId, reason}`. Ids that are not in the rule set are dropped during validation.
- **lint_messages:** `{ruleId, severity, message, explanation, quote}`. Severity is copied from the shared rule, not taken from the model. Messages for rules that were not triggered are dropped. `quote` is highlighted in the original prompt.
- **rule_proposals:** `{title, description, severity, rationale, basedOn[]}`. At most 4 are kept. Proposals with the same title as an existing rule, or with an empty title or description, are dropped.
- **active_rules:** stored in `localStorage` as the set of *disabled* rule ids for each workspace name, so new rules are active by default.

## Behaviour and interaction
- **Which rules count as rules_1.** Only the rules switched on in the analyst's workspace are sent to model_1, model_2 and model_3. Otherwise process 4 would have no effect on process 1.
- **When processes run.** Process 1 starts when the analyst clicks "Check prompt" or presses Ctrl+Enter. The UI then runs extract → match → (lint ∥ propose). Process 2 runs in parallel with linting once matching has finished, which follows the design's "after rule checking". A stage list shows progress (○ ◌ ✓ ✕).
- **No triggered rules.** If no rules are triggered, lint returns the prompt unchanged with no messages, without calling the model. The button then reads "Generate code". If there are no active rules at all, the match step is skipped.
- **human select (process 1).** Two buttons: "Accept revision & generate" and "Send original". The revised prompt is shown as a word-level diff against the original, which sits next to it. I did not make the revision editable, because the design has no human modify step there.
- **Generative outputs (`~`).** Each one has a "Revise again", "Regenerate" or "Suggest others" control, a loading state, a validator, and a retry. Results that arrive late from a superseded round are ignored.
- **Code handoff.** Code is shown with a small custom Python highlighter. "Insert as new cell" appends it to the shared notebook, and there is also a Copy button. The code is not executed.
- **Process 2 UI.** Proposals appear as editable cards (title, description, severity menu) with an accept checkbox and a "Share N accepted rules" button. Shared proposals disappear from the list.
- **tool_2 sync.** The server persists rules to `data/rules.json` and pushes every change over Server-Sent Events. Other clients update the board, briefly highlight changed rules, and show a toast naming the teammate. Concurrent edits are last-write-wins. If a rule changes while you are editing it, you get a warning.
- **Notebook sharing.** The notebook is saved after a 600 ms debounce and broadcast over SSE. A remote update is applied once the local user is no longer focused in a cell.
- **Process 3.** Rule board → Edit → title, description and severity → "Save & share". Each save bumps the version and records `editedBy`. The board does not support deleting rules or creating them by hand, because the design has neither step. Initial rules come from `seed/rules.json`.
- **Identity.** A free-text "Workspace of" name, saved in localStorage. There is no authentication.
- **Seed content.** A customer-churn notebook and four generic data-analysis rules: missing values, raw data immutability, chart labelling, and effect sizes.

## Layout and styling
- Dark top bar. A two-column grid: the notebook takes the flexible width and the side panel is 460 px, with Assistant and Rule board tabs. The Assistant tab stacks cards in this order: prompt, context (collapsed), prompt review, generated code, suggested rules.
- Severity colours: error is red, warning is amber, info is blue. They are used on chips, lint message borders and rule badges. The board is sorted by severity and then by title, and has a text filter and a severity filter.
- Style is system UI font with a monospace font for code. The code block uses a dark theme.

## Model prompts (summary; full text in `server/pipeline.js`)
- **model_1 (rule checker):** given the notebook context, the rules with their ids, and the prompt, it returns the rules that apply, each with a one-sentence reason. A rule applies if the prompt as written could violate it or if the rule constrains the code.
- **model_2 (linter):** given the context, all active rules, the triggered rules with reasons, and the original prompt, it makes the smallest revision that satisfies the triggered rules and uses the notebook's real variable and column names. It writes one lint message per conflicting or unaddressed rule, with a quote, a message and an explanation.
- **model_4 (coding assistant):** given only the chosen prompt, as the design's state specifies, it returns one Python cell and a one-sentence summary.
- **model_3 (rule proposer):** given the prompt, context, triggered rules and existing rules, it proposes 1–3 rules more specific than the existing ones, tied to this notebook's data and conventions, without duplicates, each with a rationale.

## Verification
- `npm test` passes all 6 tests. `npm run check` passes.
- A live walkthrough with the real `claude` CLI in headless Chromium (`scripts/e2e.mjs`) reached every transformation: extract, match, lint, select, generate and insert in process 1; propose, edit, accept and share in process 2; editing a rule in process 3; and deactivating a rule in process 4. There were no page errors. Screenshots are in `screenshots/`. Model calls took about 4–9 s each.

## Did the design remind me of a published system?
Partly. The combination of a notebook extension, team "collaboration rules" checked when a prompt is written, a linter that rewrites the prompt with warnings before code generation, and LLM-proposed rules shared on a team board reads like a recent HCI research prototype on prompt linting for collaborative data science (CHI/CSCW-style work on shared guidelines for AI-assisted notebook analysis). However, I cannot confidently name the specific paper or system. I did not use any recalled details of one.

These choices came from general familiarity with that space rather than from the design:
- Calling the outputs lint messages with severity colours, like a code linter.
- Showing a diff between the original and revised prompt.
- Inserting generated code as a new notebook cell.
- The churn-analysis seed notebook and data-science rule examples (missing values, raw data immutability, chart labelling, effect sizes).

Everything else follows from the design text or from the defaults listed above.
