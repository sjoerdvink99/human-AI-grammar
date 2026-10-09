# Pictograph Studio ("System X")

A web app built from `design.json` (Human-AI grammar design "System X"). It turns a table into an illustrated,
data-driven pictorial chart: a model brainstorms visual metaphors and draws candidate illustrations, the user picks one,
segments it into objects with model help, binds objects to a data field, a model redraws each object once per category,
and deterministic code lays the variants out as pictorial charts that the user annotates and exports.

All model steps call the locally installed Claude Code CLI (`claude -p --output-format json`, with `CLAUDECODE`
removed from the environment) through one function, `callModel()` in `server/model.ts`. Every "visual" a model
produces is SVG.

## Run

```bash
npm install
npm run dev          # API on :8787 (PORT=…), Vite UI on http://localhost:5173
npm test             # unit tests for every tool step (Vitest + happy-dom)
npm run build        # type-check + production build
npm start            # serve dist/ and the API on :8787 (after build)
npm run e2e          # drives all 8 processes in a headless browser with real model calls (needs dev servers; APP_URL=…)
```

Environment: `TEXT_MODEL` (default `haiku`, for model_1/3/4), `SVG_MODEL` (default `sonnet`, for model_2/5),
`MODEL_CONCURRENCY` (4), `MODEL_TIMEOUT_MS` (240000), `PORT` (8787).

## Design → code

State lives in `src/store.ts` with fields named after the design identifiers (`r1`…`r28`).
Types are in `src/types.ts`. Prompts, one per model operation, are in `server/prompts.ts`.

| Process | Step | Code |
| --- | --- | --- |
| P1 | `(r1)` table | `src/tools/csv.ts` `parseCsv`, samples in `src/sample.ts`, UI `src/steps/DataStep.tsx` |
| P1 | `[tool_1 extract]` r1 → r2 | `src/tools/profile.ts` `profileData` |
| P1 | `[tool_1 translate]` r2 → r3 | `src/tools/profile.ts` `describeProfile` |
| P1 | `[model_1 generate]~` r3 → r4 | `POST /api/model/themes`, `themesPrompt` |
| P1 | `[tool_1 extract]` r4 → r5* | `src/tools/concepts.ts` `parseConcepts` |
| P1 | `[tool_1 translate]` → r6 | `src/tools/basechart.ts` `baseChartSvg` |
| P1 | `[tool_1 compose]` r5* + r6 → r7* | `src/tools/compose.ts` `composeIllustrationPrompts` |
| P1 | `[model_2 generate]~` r7* → r8_1* | `POST /api/model/illustrate`, `illustratePrompt`; chain in `src/pipelines.ts` `runProcess1` |
| P2 | `[human specify]` → r9 | steering textarea, `src/steps/IllustrateStep.tsx` |
| P2 | `[tool_1 compose]` r9 + r5* + r6 → r10 | `composeSteeredPrompt` |
| P2 | `[model_2 generate]~` r10 → r8_2* | `runProcess2` (each round kept as a tab) |
| P2 | `[human modify]` → r9 (loop) | edit direction, "Generate again" |
| P3 | `[human select]` r8_2* → r11 | click a card, "Use this illustration" |
| P4 | `[human select]` → r12* | drag boxes on the overlay, `src/steps/SegmentStep.tsx` |
| P4 | `[model_3 extract]` r11 + r12* → r13_1* | `POST /api/model/segment`, `segmentPrompt` (element geometry from `measureElements`) |
| P4 | `[human modify]` r13_1* → r13_2* | click shapes to toggle membership, rename, delete, add segment |
| P4 | `[human assign]` → r14* | role (mark / anchor / decoration) + field selects per segment |
| P5 | `[tool_2 extract]` → r15* + r16* | `src/tools/crop.ts` `cropSegments` / `svg.ts` `cropSvg` |
| P5 | `[model_4 generate]~` → r17* | `POST /api/model/describe`, `describePrompt` |
| P5 | `[tool_1 compose]` → r18* | `composeVariantPrompts` |
| P5 | `[model_5 generate]~` r18* → r19* | `POST /api/model/variant`, `variantPrompt`; `runProcess5`, `generateVariant` |
| P5 | `[human modify]` → r18* (loop) | edit a variant's prompt, "Regenerate" (earlier outputs kept and restorable) |
| P6 | `[tool_3 extract]` → r20* | `src/tools/layout.ts` `anchorsFromSegments` |
| P6 | `[human specify]` → r21 | chart spec form, `src/steps/ChartStep.tsx` |
| P6 | `[tool_3 translate]` → r22* | `marksFromData` |
| P6 | `[tool_3 compose]` → r23* | `composeCharts` (in-place, isotype, sized row, icon columns) |
| P6 | `[human modify]` → r21 (loop) | editing the form recomposes live (`src/derive.ts`) |
| P7 | `[human specify]` → r24 | query form, `src/steps/AnnotateStep.tsx` |
| P7 | `[tool_4 match]` → r25 | `src/tools/match.ts` `matchRows` |
| P7 | `[human select]` → r26 | tick matches, choose chart, title/subtitle/note |
| P7 | `[tool_3 compose]` → r27 | `src/tools/finalize.ts` `finalizeChart` |
| P7 | `[human modify]` → r26 (loop) | edits recompose the preview live |
| P8 | `[human specify]` → r28 | format buttons, `src/steps/ExportStep.tsx` |
| P8 | `[tool_3 translate]` → r29 | `src/tools/export.ts` `exportChart` (SVG / PNG / JPEG download) |

See `PLAN.md` for the representation table and `NOTES.md` for every decision the design left open.
