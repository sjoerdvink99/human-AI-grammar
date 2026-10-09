# System X

A chart-authoring tool for tabular data, built from the Human-AI grammar design in `design.json`.
You put fields on encoding shelves to make a chart. When the chart needs fields the table doesn't have, you can:
- **formulate them by example** (fill in a few rows; a reshaping synthesizer finds fold/pivot programs), or
- **derive them with AI** (describe the field; the model writes code candidates that run on the data so you can compare and pick one).

## Run

```bash
npm install
npm run dev          # API on :3001, UI on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:3001
npm test             # unit tests for every tool step
npm run typecheck
```

Model calls use the local Claude Code CLI (`claude -p --output-format json --tools ""`, CLAUDECODE removed).
Set `MODEL=<alias>` to pick a model, `CLAUDE_BIN` to point at another binary. To change the provider, replace `callModel` in `server/model.ts`.

## Design → code map

| Process | Transformation | Implementation |
|---|---|---|
| P1 | `[tool_1 extract]` r1 → r2* | `extractFields` — `src/tools/extract.ts` |
| P1 | `[human specify]` r3 | `EncodingShelf` — `src/components/EncodingShelf.tsx` |
| P1 | `[tool_1 translate]` r3 → r4 | `translateToSpec` — `src/tools/translate.ts` |
| P1 | `[tool_1 execute]` r4 → r5 | `Chart` (vega-embed) — `src/components/Chart.tsx` |
| P2 | `[human specify]` r6* | "+ Concept" — `src/components/FieldPanel.tsx` |
| P2 | `[human specify]` r3_2 | concept chips dropped on `EncodingShelf` |
| P2 | `[tool_1 compose]` r7 | `composeExampleTable` — `src/tools/composeExample.ts` |
| P2 | `[human modify]` r7_1 → r7_2 | editable example grid — `src/components/FormulatePanel.tsx` |
| P2 | `[tool_2 execute]` r8* | `synthesizePrograms` — `src/tools/synthesize.ts` |
| P2 | `[tool_1 execute]` r9* | `runProgram` — `src/tools/reshape.ts` |
| P2 | `[tool_1 translate]` r4_2 | `translateToSpec`, per candidate in `FormulatePanel` |
| P2 | `[tool_1 execute]` r10* | `Chart` gallery in `FormulatePanel` |
| P2 | `[human select]` → r1_2 + r5_2 | "Use this" → `onFormulated` — `src/App.tsx` |
| P2 | `[tool_1 assign]` r2_2 | `assignFields(…, 'reshaped')` — `src/tools/extract.ts` |
| P3 | `[human specify]` r11 | derive form — `src/components/DerivePanel.tsx` |
| P3 | `[tool_1 compose]` r12* | `composePrompts` — `src/tools/composePrompts.ts` |
| P3 | `[model generate]~` r13* | `POST /api/generate` → `callModel` — `server/index.ts`, `server/model.ts` |
| P3 | `[tool_1 evaluate]` r14* + r15* | `POST /api/evaluate` → `evaluateCandidates` — `server/sandbox.ts` |
| P3 | `[human select]` r16 | candidate cards — `DerivePanel` |
| P3 | `[tool_1 execute]` r1_3 + r2_3 | `POST /api/execute` → `applyDerivation`; `onDerived` — `src/App.tsx` |
| P3 | `[human specify]` r3_3 → translate → execute | same as P1 |
| P4 | `[human modify]` r11_1 → r11_2 | ✎ on a derived field reopens `DerivePanel` prefilled |
| P4 | compose → generate → evaluate → select → execute | same functions as P3; executing replaces the column (r1_4, r2_4) |

Representation types are in `src/types.ts`; see `PLAN.md` for the full table.
