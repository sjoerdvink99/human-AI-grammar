# System X — concept → parts → assembly → fabrication

A web app built from the Human-AI grammar design in `design.json` (11 processes). You describe an object.
The app generates concept images, writes a specification, splits the object into physical parts, grounds the
parts in the image, and lifts them into 3D. You then assemble and edit the parts, check them against
fabrication constraints with an AI advisor, and export OpenSCAD code and dimensioned drawings.

See `PLAN.md` for how the design was interpreted and `NOTES.md` for every decision the design left open.

## Run

Requirements: Node 20+ and the Claude Code CLI (`claude`), logged in. No API key is needed.

```bash
npm install
npm run dev          # API on :8787 + Vite on http://localhost:5173
npm test             # unit tests for the deterministic tools
npm run build        # type check + production build
npm start            # build, then serve app + API on :8787
```

Optional environment variables: `MODEL_1` … `MODEL_4` (CLI model per role, default `sonnet`), `PORT`.

Smoke tests against a running dev server:
`npx tsx scripts/walkthrough.ts` calls every model operation through the API.
`npx tsx scripts/ui-walkthrough.ts` drives the UI through all processes with Playwright and saves screenshots to `.data/shots/`.

## Model provider

All model steps go through `callModel()` in `server/provider.ts`. It runs
`claude -p … --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from the environment.
To use another provider, swap that one function. The prompts, schemas, and output validation (zod) for each
model operation are in `server/ops.ts`. Since the only available model produces text, every visual
artifact (`model_2`) is an SVG.

## Design → code map

| Process | Step | Actor op | Code |
| --- | --- | --- | --- |
| P1 | r1 → r2* | model_2 generate~ | `p1Generate` (`src/web/pipelines.ts`) → op `generateImage` (`server/ops.ts`) |
| P1 | r2* → r3 | human select | `ConceptPanel` gallery → `p1Select` |
| P2 | r3 → r4 | human specify | `ConceptPanel` “Edit the concept” |
| P2 | r3 + r4 → r3_2 | model_2 modify~ | `p2Edit` → `editImage`; versions r3_n kept as chips |
| P3 | r3 → r5 | model_1 generate~ | `p3GenerateSpec` → `generateSpec` |
| P3 | r6 | human specify | `SpecPanel` feedback |
| P3 | r5 + r6 → r5 (loop) | model_1 modify~ | `p3ReviseSpec` → `reviseSpec`; “Revise again”, rounds kept |
| P4 | r3 + r5 → r7 | human select | `PartsPanel` checklist + overall size |
| P4 | → r8* | model_1 extract | `p4Build` → `extractParts` |
| P4 | → r9 | model_1 extract | `p4Build` → `extractAssemblyNotes` |
| P4 | → r10 + r11* | tool_1 modify | `normalizeReference`, `initialParts` (`src/shared/tools1.ts`) |
| P4 | → r12* | model_1 extract | `p4Round` → `groundingQueries` |
| P4 | → r13* | model_3 extract | `p4Round` → `ground` |
| P4 | → r11_2* | tool_1 translate | `boxesToParts` |
| P4 | → r14 | model_1 generate~ | `p4Round` → `critiqueParts` |
| P4 | → back to r10… (loop) | model_2 modify~ | `p4ApplyCritique` → `editImage`; stops when model_1 says ok or after 2 rounds; “Run another round” |
| P5 | → r15* | tool_1 evaluate | `checkBoxes` |
| P5 | → r16* | model_3 modify | `p5Refine` → `reground` |
| P5 | → r15_2* | tool_1 evaluate | `checkBoxes` |
| P5 | → r17* | model_2 generate~ | `p5Refine` → `sideView` (one per part) |
| P5 | → r18* | tool_1 extract | `svgSilhouetteBox` (`src/web/svgdom.ts`) |
| P5 | → r19* | tool_1 translate | `refinePartsFromViews` |
| P6 | r20 → r21* | model_2 generate~ | `p6Generate` → `generateImage` (kind `part`) |
| P6 | → r22 | human select | `StudioPanel` gallery → `p6Select` |
| P6 | → r23 | model_1 evaluate | `judgePartImage` |
| P6 | → r24 | model_2 generate~ | `cleanPartImage` |
| P6 | → r25 | tool_1 extract | `svgSilhouetteBox` |
| P6 | → r26 | tool_1 translate | `imageToPart` |
| P7 | r11* → r27 | tool_2 compose | `composeAssembly` (`src/shared/tools2.ts`) via `p7Compose` |
| P7 | r27 → r28 | tool_2 translate | `AssemblyView` (three.js; `buildGeometry` extrudes SVG profiles) |
| P7 | → r27_2 | human modify | gizmo drag, inspector fields, duplicate/delete, add/replace parts; `commitAssembly` keeps the versions (undo/redo) |
| P7 | → r28 (loop) | tool_2 translate | re-render on every change |
| P8 | → r29 | human select | part picker / click in 3D |
| P8 | → r30 | tool_1 extract | `cropSvg` in `p8Regenerate` |
| P8 | → r31 | model_2 modify~ | `regeneratePart` |
| P8 | → r32 | tool_1 translate | `svgSilhouetteBox` + `imageToPart` |
| P9 | → r33, r34 | human select, specify | part picker + “Change by description” |
| P9 | → r35* | model_1 extract | `p9LanguageEdit` → `planPartEdit` |
| P9 | → r36* | model_3 extract | `place3d` |
| P9 | → r37* | tool_1 translate | `placementsToParts`, shown as ghosts before applying |
| P10 | r27 + r38 → r39* | tool_3 evaluate | `runFabChecks` (`src/shared/tools3.ts`) |
| P10 | → r40 | model_4 generate~ | `p10Check` → `adviseFab` |
| P10 | → r41 | human select | “Apply” on a suggestion |
| P10 | → r42 | model_4 translate | `p10Apply` → `suggestionToOps` |
| P10 | → r27 (loop) | tool_3 execute | `applyOps`, then the checks run again |
| P11 | → r43* + r44* | tool_1 translate | `toOpenScad`, `toDrawingSvg` via `p11Translate` |
| P11 | → r45 | human select | format chips in `ExportPanel` |
| P11 | → r46 | tool_1 compose | `composeExport` → download |
