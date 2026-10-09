# System X — guideline-aware analysis assistant

Implementation of the Human-AI grammar design in `design.json` (see `PLAN.md` for the interpretation and
`NOTES.md` for every decision the design left open).

Load a dataset, write a question. The app profiles the data, matches the question to guidelines in a shared
library, rewrites the question so it follows them, and shows how each guideline was handled. Once you accept the
rewrite, it generates Python/pandas code. From the same context it can suggest new guidelines, which you edit,
pick and merge into the library. You can also edit the library and select guidelines to export.

## Run

```bash
npm install
npm start            # http://localhost:3000  (PORT to change)
npm test             # unit tests for the tool steps
npm run check        # syntax check of all sources
```

Model steps call the local Claude Code CLI (`claude -p --output-format json --json-schema …`, run with
`CLAUDECODE` removed). All of them go through `callModel()` in `src/model.js`, so you can swap the
provider by editing that one function. Optional env: `CLAUDE_BIN`, `MODEL_NAME`, `MODEL_TIMEOUT_MS`, `LIBRARY_FILE`.

## Design → code

| Process | Step | Code |
| --- | --- | --- |
| 1 | `[human specify]` → r3_1 | request textarea and Run button, `public/app.js` (`#run` handler) |
| 1 | `[tool_1 extract]` r1 → r4 | `extractProfile()` in `src/tools.js`, `POST /api/extract` |
| 1 | `[model_1 match]` → r5* | `matchGuidelines()` in `src/steps.js`, `POST /api/match` |
| 1 | `[model_2 modify]~` → r3_2 + r6* | `refineRequest()` in `src/steps.js`, `POST /api/refine` |
| 1 | `[human select]` → r3_2 | "Use this refined request" and version tabs, `public/app.js` (`#accept-refined`) |
| 1 | `[model_4 generate]~` → r7 | `generateCode()` in `src/steps.js`, `POST /api/generate-code` |
| 2 | `[model_3 generate]~` → r8* | `suggestGuidelines()` in `src/steps.js`, `POST /api/suggest` |
| 2 | `[human modify]` → r8_2* | editable suggestion cards, `renderSuggestions()` in `public/app.js` |
| 2 | `[human select]` → r9* | "Keep" checkboxes on suggestion cards |
| 2 | `[tool_2 compose]` → r2_2* | `composeLibrary()` in `src/tools.js`, `POST /api/compose` |
| 3 | `[human modify]` r2_2 → r2_3* | library Edit / Delete / + Add, `PUT/DELETE/POST /api/library` |
| 4 | `[human select]` r2_2 → r10* | library checkboxes, Select all / Clear / Export selected |

Representations r1–r10 appear under the same names in the client `state` object (`public/app.js`) and in the
API payloads.
