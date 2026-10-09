# System X — rule-based prompt linting for notebook code generation

Built from the Human-AI grammar design in [`design.json`](design.json). You write a prompt for the next notebook
cell. The app extracts the notebook context and checks the prompt against your own **rules**. A model rewrites the prompt and
explains each change as a **lint message**. You pick the original or the revised prompt, and a model generates the code.
From any lint run you can ask for **new rule proposals**, edit them, and accept them into your rule set. You can also edit
rules directly and choose which ones are active.

## Run

```bash
npm start          # http://localhost:5173
npm test           # unit tests for the tool steps and the rule store
npm run check      # syntax check
```

Requirements: Node ≥ 20 and the Claude Code CLI (`claude`) on `PATH`, logged in. No npm dependencies.
Environment variables: `PORT`, `CLAUDE_MODEL` (passed to `--model`), `CLAUDE_BIN`, `MODEL_TIMEOUT_MS`,
`RULES_FILE` (default `data/rules.json`), `MOCK_MODEL=1` (deterministic stand-in, no model calls).

All model calls go through `callModel()` in [`server/provider.js`](server/provider.js). It runs
`claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from the environment. To use a
different provider, replace that one function.

## Design → code

| Process | Step | Code |
| --- | --- | --- |
| 1 | `notebook_1` (artifact record) | notebook pane, `public/app.js` (`state.notebook`, `.ipynb` import) |
| 1 | `[human specify]` → `prompt_1` | prompt field + **Lint prompt**, `lintPrompt()` in `public/app.js` |
| 1 | `[tool_1 extract]` → `context_1` | `extractContext()` in `server/tools.js`, `POST /api/extract` |
| 1 | `[model_1 match]` → `triggered_rules_1` | `matchRules()` in `server/models.js`, `POST /api/match` (active rules only) |
| 1 | `[model_2 modify]~` → `prompt_2` + `lint_messages_1` | `modifyPrompt()` in `server/models.js`, `POST /api/modify` |
| 1 | `[human select]` → `prompt_2` | Original/Revised cards with word diff, `renderRun()` in `public/app.js` |
| 1 | `[model_4 generate]~` → `code_1` | `generateCode()` in `server/models.js`, `POST /api/generate-code` |
| 2 | `[model_3 generate]~` → `rule_proposals_1` | **Suggest rules from this prompt**, `proposeRules()` in `server/models.js`, `POST /api/propose-rules` |
| 2 | `[human modify]` → `rule_proposals_2` | editable proposal cards, `renderProposals()` / `bindProposals()` |
| 2 | `[human select]` → `accepted_rules_1` | accept checkboxes on proposals |
| 2 | `[tool_2 compose]` → `rules_2` | `composeRules()` in `server/tools.js`, `POST /api/compose-rules` |
| 3 | `[human modify]` `rules_2` → `rules_3` | rule editor (edit/new/delete), `bindRules()`, `PUT /api/rules`; versions in `server/rulesStore.js` |
| 4 | `[human select]` → `active_rules_1` | per-rule *active* checkbox, `PUT /api/rules/active` |

Rule versions (`rules_1`, `rules_2`, `rules_3`, …) are kept in `data/rules.json`. You can restore any of them from the
**History** tab.
