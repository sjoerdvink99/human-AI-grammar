# PLAN — System X: a rule-based prompt linter for notebook code generation

The design has no goal, description, representation descriptions, references or images.
Reading the identifiers, it describes: a user writes a natural-language prompt inside a
computational notebook; the notebook context is extracted; a model checks the prompt
against a user-owned set of **rules**; a second model rewrites the prompt and explains the
changes as **lint messages**; the user picks the prompt to use; a code model generates code.
A third model proposes new rules from the run; the user edits and accepts them; and the user
can edit the rule set and choose which rules are active.

Defaults taken (no confirmation, per the experiment instructions) are marked **[default]**.

## Stack [default]
Repository is empty. Node 20, zero runtime dependencies:
- `server/` — `node:http` server, JSON API, rules persisted to `data/rules.json`.
- `public/` — static HTML/CSS/vanilla JS single page.
- Model provider: the local Claude Code CLI (`claude -p --output-format json --json-schema …`,
  spawned with `CLAUDECODE` removed), wrapped in one function `callModel()` in `server/provider.js`.
- Tests: `node --test`.

## Representations

| Identifier | Type | Contents | File |
| --- | --- | --- | --- |
| notebook | artifact record | `{title, cells:[{id, type:'code'|'markdown', source, output}]}`; editable in left pane, `.ipynb` import | `public/app.js` (state.notebook), `server/sample.js` |
| rules (1,2,3) | instruction record* | `{id, name, condition, guidance, severity:'info'|'warning'}`; versioned history kept on disk | `server/rulesStore.js` |
| prompt (1,2) | instruction language | prompt_1 = user's text; prompt_2 = rewritten prompt (selected one is what goes to code gen) | `public/app.js` (state.run) |
| context | artifact record | `{imports, variables, functions, dataframes:[{name, columns}], headings, recent_cells}` | `server/tools.js` |
| triggered_rules | selection record* | `{rule_id, reason}` referring into rules | `server/models.js` |
| lint_messages | evaluation record* | `{rule_id, severity, message, change}` | `server/models.js` |
| code | artifact formal | Python code string | `server/models.js` |
| rule_proposals (1,2) | instruction record* | same fields as a rule + `rationale`; editable before acceptance | `server/models.js`, `public/app.js` |
| accepted_rules | instruction record* | checked proposals | `public/app.js` |
| active_rules | selection record* | list of rule ids | `server/rulesStore.js` |

## Transformations

| Process | Actor op | Function / component | File |
| --- | --- | --- | --- |
| P1 | human specify | prompt textarea + "Lint prompt" | `public/app.js` `lintPrompt()` |
| P1 | tool_1 extract | `extractContext(notebook)` | `server/tools.js` |
| P1 | model_1 match | `matchRules(context, rules, prompt)` | `server/models.js` |
| P1 | model_2 modify~ | `modifyPrompt(context, rules, prompt, triggered)` | `server/models.js` |
| P1 | human select | original vs. revised prompt cards, "Use this prompt" | `public/app.js` `renderLint()` |
| P1 | model_4 generate~ | `generateCode(prompt)` (only the selected prompt) | `server/models.js` |
| P2 | model_3 generate~ | `proposeRules(prompt, context, triggered, rules)` — button "Suggest rules from this prompt" | `server/models.js` |
| P2 | human modify | editable proposal cards | `public/app.js` `renderProposals()` |
| P2 | human select | accept checkboxes + "Add accepted rules" | `public/app.js` |
| P2 | tool_2 compose | `composeRules(rules, accepted)` (ids, dedupe by name, validation) | `server/tools.js` |
| P3 | human modify | inline rule editor → new rules version | `public/app.js` `renderRules()`, `PUT /api/rules` |
| P4 | human select | "active" checkbox per rule | `public/app.js`, `PUT /api/rules/active` |

## Images
None in the design.

## Open choices and defaults
- Layout [default]: three columns — notebook | prompt assistant | rules (tabs: Rules, Proposals, History).
- Matching uses only *active* rules (P4 feeds P1 through the shared `rules` state).
- P2 trigger [default]: explicit button after a lint run, using that run's snapshot of prompt_1, context_1, triggered_rules_1, rules_1.
- If model_1 triggers no rules, model_2 is still called? [default: no] — prompt_2 = prompt_1, no lint messages; avoids a pointless generative call.
- model_4 sees only prompt_2 (as in the design), so model_2 is told to carry the needed notebook details (variable names, columns) into the rewrite.
- Persistence [default]: rules and their history on disk; notebook in browser localStorage.
- No code execution and no automatic insertion of generated code into the notebook (not in the design); a Copy button is provided.
