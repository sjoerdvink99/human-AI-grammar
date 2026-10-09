# System X

Prompt-time linting, analytic intent scaffolding, code generation handoff and shared rule management for a shared analysis notebook. Built from `design.json` (Human-AI grammar design).

## Run

```bash
npm start            # http://localhost:5173  (PORT=… to change)
npm test             # unit tests (parser, rule store, output validation, UI helpers)
npm run check        # syntax check of all modules
# optional UI walkthrough of processes 1–4 (needs a Chromium binary):
node --experimental-websocket scripts/e2e.mjs <chrome-binary> http://localhost:5173/
```

Requirements: Node ≥ 20 and the `claude` CLI on `PATH`. There are no npm dependencies. Every model call goes through `callModel()` in `server/llm.js`. That function runs `claude -p --output-format json --tools ""` with `CLAUDECODE` removed from the environment. Set `SYSTEMX_MODEL` to choose the model (default `sonnet`).

Shared state lives in `data/` and is seeded from `seed/` on first start. Open two browser windows with different workspace names to see rule sharing.

## Design → code

| Process | Step | Code |
|---|---|---|
| 1 Prompt-time linting | `[human specify]` → prompt_1 | `public/app.js` `submitPrompt` (prompt box, Ctrl+Enter) |
| | `[tool_1 extract]` notebook_1 → context_1 | `server/extract.js` `extractContext`, `POST /api/extract` |
| | `[model_1 match]` → triggered_rules_1 | `server/pipeline.js` `matchRules`, `POST /api/match` |
| | `[model_2 modify]~` → prompt_2 + lint_messages_1 | `pipeline.js` `lintPrompt`, `POST /api/lint`; UI `renderLint` (diff + messages, "Revise again") |
| | `[human select]` → prompt_2 | "Accept revision & generate" / "Send original" buttons (`generate`) |
| | `[model_4 generate]~` → code_1 | `pipeline.js` `generateCode`, `POST /api/generate`; "Insert as new cell" hands the code to the notebook |
| 2 Propose & share rules | `[model_3 generate]~` → rule_proposals_1 | `pipeline.js` `proposeRules`, `POST /api/propose`; starts automatically after rule checking |
| | `[human modify]` → rule_proposals_2 | editable proposal cards (`renderProposals`) |
| | `[human select]` → accepted_rules_1 | checkbox per proposal |
| | `[tool_2 compose]` → rules_2 | `server/rules.js` `RuleStore.compose`, `POST /api/rules/compose`, SSE broadcast `/api/events` |
| 3 Edit shared rules | `[human modify]` rules_2 → rules_3 | Rule board → Edit → `RuleStore.update`, `PUT /api/rules/:id` |
| 4 Choose active rules | `[human select]` → active_rules_1 | Rule board switch (`setRuleActive`, localStorage per workspace). Only active rules are sent to model_1/2/3 |
