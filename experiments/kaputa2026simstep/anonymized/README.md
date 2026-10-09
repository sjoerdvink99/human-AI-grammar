# System X — from a request to a working visualization program

An implementation of the Human-AI grammar design in [`design.json`](design.json) ("System X").
The design names no domain, so this build interprets it as a tool that turns a natural-language request
into a data-driven SVG visualization program through a chain of graphs, tests that program automatically,
and lets you refine it from the rendering (regions, sketches, component parameters, test reviews).
See [PLAN.md](PLAN.md) for the full mapping and [NOTES.md](NOTES.md) for every decision the design left open.

## Run

Requirements: Node 20+, and the Claude Code CLI (`claude`) installed and logged in. No API key is used —
every model step shells out to `claude -p --output-format json` (with `CLAUDECODE` removed from the environment).

```bash
npm install
npm run dev          # API on :8787, UI on http://localhost:5173
# or: npm start      # production build served from :8787
```

Optional env: `CLAUDE_MODEL` (e.g. `sonnet` for faster runs), `CLAUDE_BIN`, `PORT`.

Checks: `npm run typecheck`, `npm test` (vitest), `npm run build`.
End-to-end walkthrough of all 8 processes in headless Chromium (real model calls, ~15–25 min):
`npm run dev` then `node scripts/walkthrough.mjs`.

## Where each transformation lives

The model provider is a single function, `callModel()` in [`server/llm.ts`](server/llm.ts).
Every model step is one entry in `OPS` in [`server/ops.ts`](server/ops.ts) (prompt + JSON schema + validator),
served at `POST /api/op/<name>`. Deterministic tools are in [`src/tools/`](src/tools).

| Process | Step | Code |
|---|---|---|
| 1 | r1 → `[model translate]~` → r2 | op `intentGraph`; `startDesign` in `src/store.ts` |
| 1 | r2 → `[model generate]~` → r3* | op `concepts`; `generateConcepts` |
| 1 | `[human select]` → r4 | concept cards, `src/components/DesignFlow.tsx` |
| 1 | r2+r4 → `[model translate]~` → r5 | op `designGraph`; `selectConcept` |
| 1 | r5 → `[model generate]~` → r6* | op `buildOptions`; `regenerateBuildOptions` |
| 1 | `[human select]` → r7 | build-option cards, `DesignFlow.tsx` |
| 1 | r5+r7 → `[model select]` → r8 | op `selectScope` (ids → `subgraph()` in `src/shared/validate.ts`) |
| 1 | `[model extract]` → r9 | op `dataSpec` |
| 1 | `[model generate]~` → r10 | op `plan` |
| 1 | `[model generate]~` → r11_1 | op `componentGraph` |
| 1 | `[model translate]~` → r12_1 | op `code`; all in `selectBuildInstruction` |
| 2 | r2_1 → `[human modify]` → r2_2 | `src/components/GraphEditor.tsx`, `modifyIntentGraph` |
| 3 | `[tool_2 execute]` → r13* | `executeForErrors()` in `src/tools/sandbox.ts` |
| 3 | `[model modify]~` → r12_2 | op `repair` |
| 3 | `[model generate]~` → r14* | op `testCases` |
| 3 | `[tool_2 execute]` → r15* + r16* | `executeTests()` in `src/tools/sandbox.ts` |
| 3 | `[model evaluate]~` → r17 | op `evaluateTests` |
| 3 | `[model modify]~` → r12_3 | op `revise`; all in `runProcess3` |
| 3 | `[tool_1 execute]` → r18 | `src/components/VisualView.tsx` (sandboxed iframe) |
| 4 | `[human select]` → r19 | test gallery, `src/components/TestsPanel.tsx` |
| 4 | `[tool_1 execute]` → r20 | `VisualView` with the test's data |
| 4 | `[human evaluate]` → r21 | verdict buttons |
| 4 | `[model select]` → r22 | op `issueCategory` |
| 4 | `[model generate]~` → r23 | op `fixOptions` |
| 4 | `[human select]` → r24 | fix option cards |
| 4 | `[model modify]~` → r25_4 | op `applyFix` |
| 5 | `[human select]` → r26 | "Edit region" drag on `VisualView` |
| 5 | `[human specify]` → r27 | text field, `RegionEditPanel` in `src/components/ToolPanels.tsx` |
| 5 | `[model select]` → r22_2 | op `regionCategory` |
| 5 | `[model generate]~` → r28 | op `graphEditOptions` |
| 5 | `[human select]` → r29 | graph-edit option cards |
| 5 | `[tool_1 modify]` → r11_2 | `applyGraphEdit()` in `src/tools/graphEdit.ts` |
| 5 | `[model modify]~` → r30_4 | op `codeFromGraph` |
| 6 | `[human select]` → r31 | component menu / node click, `ParamsPanel` |
| 6 | `[model extract]` → r32_1 | op `extractParams` |
| 6 | `[human modify]` → r32_2 | parameter form |
| 6 | `[model modify]~` → r33_4 | op `applyParams` |
| 7 | `[human select]` → r34 | "Sketch" region drag |
| 7 | `[human specify]` → r35 | freehand strokes in the region, `VisualView` overlay |
| 7 | `[model translate]~` → r36 | op `sketchToCode`, `SketchPanel` |
| 7 | `[model modify]~` → r37_4 | op `mergeFragment` |
| 7 | `[tool_1 execute]` → r38 | `VisualView` re-renders the new version |
| 8 | `[human select]` → r39 | "Locate in graph" region drag |
| 8 | `[model match]` → r40 | op `matchRegion`, `LocatePanel`; highlighted in `GraphView` |
