# System X — pictorial infographic studio

A web app built from the Human-AI grammar design in [`design.json`](design.json). The design has no goal or
descriptions, so its meaning was inferred from its structure; see [PLAN.md](PLAN.md) and [NOTES.md](NOTES.md).

What it does: a model drafts infographic elements from a brief, style references and source documents. The elements
are rendered into a scene that you critique, edit and re-render in rounds. Every round is kept in a gallery where you can review it.
Each element links back to the passage and images it came from. You can get a detailed illustration of any element,
turn a table into a chart, and cut objects out of the scene with a vision model to decorate the chart.

## Run

Requirements: Node 20+, and the Claude Code CLI (`claude`) installed and logged in. No API key is needed.

```bash
npm install
npm run dev        # API on :8787, web UI on http://localhost:5173
```

Production: `npm run build && npm start` (serves `dist/` and the API on :8787).

Checks: `npm run typecheck`, `npm test` (unit tests for every deterministic tool), and `npm run e2e`.
`npm run e2e` drives all 8 processes in headless Chromium against a running `npm run dev` and makes real model
calls (about 1.5 minutes). It needs Playwright's Chromium: `npx playwright install chromium`.

Environment variables: `MODEL` (passed to `claude --model`), `CLAUDE_BIN`, `PORT`.

## Model provider

Every model step goes through `callModel()` in [`server/model.ts`](server/model.ts). It runs
`claude -p … --output-format json --json-schema …` with `CLAUDECODE` removed from the environment and reads
`structured_output`. To use a different provider, swap that one function. The three model roles have separate system prompts in
[`server/routes.ts`](server/routes.ts).

## Design → code map

| Process | Transformation | Implementation |
| --- | --- | --- |
| 1 | `[model_1 generate]~` r1+r2*+r3* → r4* | `POST /api/elements`, `server/routes.ts`; validated by `validateElement` in `shared/sanitize.ts`; triggered by `generate()` in `src/App.tsx` |
| 1 | `[tool_1 compose]` r4* → r5 | `composeSceneSpec` in `shared/compose.ts` |
| 1 | `[tool_2 execute]` r5 → r6 | `renderScene` in `shared/render.ts` |
| 1 | `[tool_7 compose]` r6 → r7* | `addSnapshot` in `shared/compose.ts` (via `renderAndSnapshot`, `src/App.tsx`) |
| 2 | `[human select]` → r9 | clicking an element box or list item in `src/components/ScenePanel.tsx` |
| 2 | `[tool_3 select]` r9 → r10 + r11* | `retrieveProvenance` / `linkedImages` in `shared/provenance.ts`; shown in the inspector |
| 3 | `[human evaluate]` → r12 | “Evaluate this round” textarea in `ScenePanel.tsx` |
| 3 | `[human modify]` r4_1 → r4_2 | dragging and resizing on the scene (`ScenePanel.tsx`) and `src/components/ElementEditor.tsx` |
| 3 | `[tool_1 compose]` → `[tool_2 execute]` → `[tool_7 compose]` (loop) | “Re-render & snapshot” → `renderAndSnapshot` |
| 4 | `[human select]` → r13 | element cards in `src/components/IllustratePanel.tsx` |
| 4 | `[tool_1 compose]` r13 → r14 | `composeIllustrationRequest` in `shared/compose.ts` |
| 4 | `[model_2 generate]~` r14 → r15 | `POST /api/illustrate`, `server/routes.ts` |
| 5 | `[human specify]` → r17 | chart-type buttons in `src/components/ChartPanel.tsx` (table r16 parsed by `parseTable`, `shared/table.ts`) |
| 5 | `[tool_4 translate]` r16+r17 → r18 | `renderChart` in `shared/chart.ts` |
| 6/7 | `[human select]` → r19/r24 | drag a rectangle on the scene in `src/components/CutoutPanel.tsx` (`cropCanvas`, `src/tools/raster.ts`) |
| 6/7 | `[human select]` → r20/r25 | click points on the crop (`CutoutPanel.tsx`) |
| 6/7 | `[model_3 extract]` → r21/r26 | `POST /api/extract`, `server/routes.ts` (vision through the CLI `Read` tool; validates the polygon against the click points and retries once) |
| 6/7 | `[tool_5 modify]` → r22/r27 | `applyMask` in `src/tools/raster.ts` |
| 7 | `[human select]` → r28 | drag and resize the cutout on the chart (`CutoutPanel.tsx`, “Place manually”) |
| 6/7 | `[tool_6 compose]` → r23/r29 | `composePictorial` (+ `autoPlacements` for P6) in `shared/pictorial.ts` |
| 8 | `[human select]` r7* → r30 | gallery thumbnails in `src/components/GalleryPanel.tsx` |
| 8 | `[human evaluate]` → r31 | “Add review” in `GalleryPanel.tsx` (stored on the snapshot) |
