# PLAN — System X (prompt linting for shared notebooks)

The design has no references and no images. The plan below was written without waiting for confirmation; the recommended default was taken for every open choice.

## Stack (empty repo → minimal)
- **Backend:** Node 20, built-in `http` only (no npm dependencies). One module, `server/llm.js`, exposes `callModel({system, prompt, schema})`. It runs `claude -p --output-format json` with `CLAUDECODE` removed from the environment, so the provider can be swapped in one place.
- **Frontend:** a single page in vanilla JS and CSS under `public/`. It stands in for the "extension for the analysts' notebook environment": a notebook pane on the left and an assistant side panel on the right.
- **Persistence:** shared state (notebook, rules) is stored in `data/*.json` on the server. Locally active rules are stored in the browser's `localStorage`, per workspace.
- **Sync (tool_2):** the server pushes rule changes to every open client through Server-Sent Events (`/api/events`).
- **Tests:** `node --test` covering the parser (tool_1), rule composition (tool_2), and output validation.

## Representations
| id | type | contents | file |
|---|---|---|---|
| notebook | `{cells:[{id,type:'code'|'markdown',source,outputs}]}` | shared notebook | `data/notebook.json`, `public/app.js` (state.notebook) |
| rules | `Rule{id,title,description,severity:'info'|'warning'|'error',author,updatedAt,version}[]` | shared rule board | `data/rules.json`, `server/rules.js` |
| prompt | string (prompt_1 original, prompt_2 revised) | analyst request | `state.prompt`, `state.revisedPrompt` |
| context | `{imports[],variables[{name,kind,cell}],dataframes[{name,source,columns[]}],functions[],files[],markdownNotes[]}` | extracted context | `server/extract.js` |
| triggered_rules | `{ruleId,reason}[]` | the rules that apply to the prompt | `server/pipeline.js` match() |
| lint_messages | `{ruleId,severity,message,explanation}[]` | warnings shown next to the revised prompt | pipeline.js lint() |
| code | string (Python) | generated code | pipeline.js generateCode() |
| rule_proposals | `{title,description,severity,rationale}[]` (editable) | proposed rules | pipeline.js proposeRules() |
| accepted_rules | the subset of proposals the analyst checks | | app.js |
| active_rules | `Set<ruleId>` stored in localStorage | per-workspace switches | app.js |

## Transformations
| process | actor op | implementation |
|---|---|---|
| 1 | human specify | prompt textarea + "Lint prompt" button (`app.js` submitPrompt) |
| 1 | tool_1 extract | `server/extract.js` extractContext (regex-based Python parser) |
| 1 | model_1 match | `server/pipeline.js` matchRules → `callModel` (rule-checker prompt); ids validated against the rule set |
| 1 | model_2 modify ~ | `pipeline.js` lintPrompt → revised prompt + lint messages; side-by-side diff view |
| 1 | human select | choose "Use revised" / "Keep original" (the revised prompt is editable before sending) |
| 1 | model_4 generate ~ | `pipeline.js` generateCode → code shown with highlighting, then "Insert as new cell" |
| 2 | model_3 generate ~ | `pipeline.js` proposeRules, triggered automatically after rule checking (in parallel with linting) |
| 2 | human modify | editable proposal cards (title, description, severity) |
| 2 | human select | checkbox per proposal + "Share accepted rules" |
| 2 | tool_2 compose | `server/rules.js` addRules (dedupes by title, assigns ids) → broadcast over SSE |
| 3 | human modify | Rule board tab: inline editing of description and severity → PUT `/api/rules/:id` → broadcast |
| 4 | human select | per-rule "active in my workspace" toggle (localStorage) |

## Open choices (defaults taken)
- Only **locally active** rules are sent to model_1. Process 4 would have no effect otherwise.
- New rules are active by default.
- model_3 runs in parallel with model_2, once model_1 has finished.
- Code is not executed. The design has no execute step, so "handoff" means inserting the code as a notebook cell.
