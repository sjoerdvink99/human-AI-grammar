# NOTES — decisions the design did not determine

The design gives only the four expressions. It has no goal, no system or process descriptions, no representation
descriptions, no references and no images. Everything below was my choice.

## Interpretation
- **What the system is for.** From the identifiers (`notebook`, `rules`, `prompt`, `context`, `triggered_rules`,
  `lint_messages`, `code`), I read it as a *prompt linter for computational notebooks*. The user's code-generation prompt
  is checked against user-defined rules, rewritten, and then used to generate a code cell.
- **What a rule is.** `{id, name, condition, guidance, severity: info|warning}`. The condition says when the rule applies,
  and the guidance says how to rewrite the prompt. Rules are natural-language records, so models do both the matching and
  the rewriting.
- **Five seed rules** (name the DataFrame, use exact column names, specify the chart, say what to return, handle missing
  values). All of them are my own.
- **Notebook record.** `{title, cells:[{id, type: code|markdown, source, output}]}`. The notebook is editable, outputs are
  typed or pasted in by hand, and `.ipynb` files can be imported. There is no kernel and no code execution.
- **Context record (tool_1).** Built with regex heuristics: imports, assigned variables with a guessed kind, functions,
  DataFrames with columns (from `df.head()` tables, `Index([...])` output, `pd.DataFrame({...})` literals and
  `df['col'] =` assignments), markdown headings, and the last 6 cells.
- **Triggered rules.** `{rule_id, reason}`. They are validated so each one refers to a rule that was given, with no duplicates.
- **Lint messages.** `{rule_id, severity (copied from the rule), message, change}`. Messages for rules that were not
  given are dropped.
- **Code.** A single Python cell. It is shown with a small hand-written highlighter and a Copy button.
- **Rule proposals.** Rule fields plus a `rationale`. Invalid proposals, and proposals whose name matches an existing
  rule, are dropped.

## Process wiring
- **Process 4 → 1.** Only *active* rules are sent to model_1. I read "process 1 and process 4 both work with rules" as the
  active selection filtering which rules are matched.
- **model_2 is skipped when model_1 triggers no rule.** In that case `prompt_2 = prompt_1`, there are no lint messages,
  and the UI says "your prompt passes the lint". The design always calls model_2; I skipped the call because it would be
  pointless.
- **model_4 receives only the selected prompt**, as the state before it contains only `prompt_2`. Because the code model
  never sees the notebook, model_2's prompt tells it to carry concrete notebook details (variables, columns, imported
  libraries) into the rewrite.
- **Human select.** The user picks either the original or the revised prompt with two radio cards. The cards show a word
  diff (deletions on the original, insertions on the revised). The revised prompt is picked by default. Neither prompt can
  be edited at this step, because the design has `select` here, not `modify`.
- **Process 2 trigger.** An explicit **Suggest rules from this prompt** button. It appears after a lint run and uses that
  run's snapshot of prompt_1, context_1, triggered_rules_1 and the rules that were matched (rules_1). The alternative was
  to run it automatically after every lint; I chose the button to save a model call.
- **tool_2 compose.** Accepted rules are merged into the *current* rule set. They get new ids `rN`. A proposal with the
  same name (case-insensitive) as an existing rule overwrites that rule. Newly added rules start active.
- **Versioning.** Every change creates a new rules version on disk: compose, edit, delete, add, restore. A History tab
  lists the versions and can restore an earlier one. Restoring was not in the design; I added it because rules change
  version (`rules_1 → rules_2 → rules_3`).
- **Process 3.** Inline editing of a rule's name, condition, guidance and severity. It also includes adding a rule from
  scratch and deleting a rule. I counted both as `human modify` of the collection.
- **Not built:** inserting the generated code into the notebook, and running it. Neither step is in the design.

## Model prompts
One system prompt per operation, all in `server/models.js`. Each one gets JSON-formatted inputs taken only from the
preceding state:
- model_1 *match*: a strict rule matcher that returns `{triggered:[{rule_id, reason}]}`.
- model_2 *modify*: keeps the user's intent, changes only what the triggered rules ask for, invents no variables, and writes
  one lint message per rule.
- model_4 *generate*: one Python notebook cell, with no fences.
- model_3 *generate*: 1–3 new, general, reusable rules that the existing rules do not already cover, each with a rationale.

All four use the CLI's `--json-schema` structured output, and the backend validates the results again.

## Stack, layout, styling
- Node 20 with no dependencies: `node:http`, vanilla JS/HTML/CSS, and `node --test`. There is no build step and no framework.
- Provider: `claude -p --output-format json --json-schema <schema> --system-prompt <role prompt> --tools "" --no-session-persistence`,
  spawned without `CLAUDECODE`, behind `callModel()`. The app reads `structured_output` and falls back to parsing JSON out of
  `result`. Timeout is 180 s. There is a `MOCK_MODEL` switch for tests.
- Three-column layout: notebook | prompt assistant | rules (tabs: Rules, Proposals, History). A pipeline of step pills
  shows progress, with spinners during model calls, error boxes and Retry/Regenerate buttons.
- Triggered rules get an orange outline and show their reason in the rules pane. Hovering a lint message highlights its
  rule.
- Severity colours: warning is orange, info is blue. The palette is neutral grey with an indigo accent.
- Persistence: the notebook is kept in the browser's localStorage, and the rules with their history in `data/rules.json`.
  There are no user accounts.
- Earlier lint runs are not kept. A new lint run replaces the current one.

## Did the design remind me of a published system?
Somewhat. The structure (notebook context, user-authored natural-language rules that "lint" a code-generation prompt,
the model proposing new rules, and toggling which rules are active) reminded me of the recent HCI research on **prompt
linting and user-defined guidelines for LLM code assistants in computational notebooks**. Examples are work on
"prompt linters" and on letting data scientists write reusable guidelines or rules that an assistant enforces. I cannot
name one specific paper with confidence. I deliberately did not look it up.

Choices that came from that general familiarity rather than from the design:
- The framing as a "linter" with *severity levels* (info/warning) and lint messages that pair "what was wrong" with
  "what changed". The design only says `lint_messages: evaluation record`; the severity field and the two-part message
  shape come from linter conventions.
- Rules phrased as a *condition* plus *guidance* (when / then).
- The specific seed rules about naming DataFrames and exact column names, which are typical data-science prompt
  ambiguities.
- The decision that proposed rules should be *general and reusable*, not specific to one prompt.

Everything else (process wiring, the skip rule, validation, layout, versioning) came from reading the grammar
expressions and the implement skill's mapping table.
