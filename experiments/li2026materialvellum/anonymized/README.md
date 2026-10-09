# System X

A web app implementing the three processes in `design.json` (Human-AI grammar) as three modes:

| Mode | Process | What happens |
| --- | --- | --- |
| **Scene** | 1 | Draw building footprints on a ground plan → beautified → extruded to a 3D block scene → orbit the camera → render → model_1 makes an image from the render → lasso regions with an intent brush → model_1 edits only those regions (before/after kept) |
| **Sketch** | 2 | Sketch → beautified shapes → sketch render + generated text description → model_1 makes an image |
| **Voice collage** | 3 | Type a scene prompt → draw boxes → move/resize them → record a voice note per box → speech mapped to a fixed category → records → model_2 writes a description per item → model_1 draws each item → items composited into a collage |

## Run

Requirements: Node 20+, the `claude` CLI installed and logged in.

```bash
npm install
npm run dev        # API on :8791, UI on http://localhost:5179
# or
npm run build && npm start   # everything on http://localhost:8791
```

Environment: `PORT` (API port, default 8791), `MODEL_1` / `MODEL_2` (optional `--model` per role),
`MAX_MODEL_CALLS` (concurrent CLI processes, default 3), `MODEL_TIMEOUT_MS` (default 420000), `CLAUDE_BIN`.

Voice notes use the browser's MediaRecorder; transcripts use the Web Speech API (Chrome/Edge/Safari).
Where speech recognition is missing, a text field lets you type what you said.

`npm test` runs unit tests for the deterministic tools, SVG validation, and a render smoke test.
`npm run typecheck` runs the TypeScript checker.

## Model provider

Every model step goes through `callModel()` in `server/provider.ts`, which runs
`claude -p --output-format json --tools "" --system-prompt …` with `CLAUDECODE` removed from the
environment. Swap the provider by replacing that one function. Images are SVG documents; all model
output is validated (`server/svg.ts`) and retried once when invalid.

## Design → code

| Process step | Actor / op | Code |
| --- | --- | --- |
| P1.1 | human specify (r2_1) | `SceneMode.tsx` ground plan `DrawCanvas`, `addFootprint` |
| P1.2 | tool_1 modify (r2_2) | `src/tools/tool1.ts` `beautifyStroke` |
| P1.3 | tool_3 compose (r3_1) | `src/tools/tool3.ts` `composeLayout` |
| P1.4 | tool_2 translate (r4_1) | `src/tools/tool2.ts` `extrudeLayout` |
| P1.5 | tool_3 translate (r5_1) | `tool3.ts` `deriveCamera` |
| P1.6 | human modify (r5_2) | `SceneMode.tsx` orbit drag / wheel / sliders |
| P1.7 | tool_2 modify (r4_2) | `tool2.ts` `applyCamera` |
| P1.8 | tool_3 translate (r6_1) | `tool3.ts` `renderScene` |
| P1.9 | model_1 generate~ (r7_1) | `server/models.ts` `model1GenerateFromRender` (`POST /api/model1/generate-from-render`) |
| P1.10 | human specify (r8_1) | `SceneMode.tsx` lasso with intent brush, `addEditStroke` |
| P1.11 | tool_1 modify (r8_2) | `tool1.ts` `beautifyStroke` (forceClosed) |
| P1.12 | tool_3 translate (r9_1, r10_1) | `tool3.ts` `strokesToSelections` |
| P1.13 | model_1 modify~ (r7_2) | `models.ts` `model1Modify` + `svg.ts` `confineEditToRegions` (`POST /api/model1/modify`) |
| P2.1 | human specify (r12_1) | `SketchMode.tsx` `add` |
| P2.2 | tool_1 modify (r12_2) | `tool1.ts` `beautifyStroke` |
| P2.3 | tool_3 translate (r13_1, r14_1) | `tool3.ts` `renderShapes`, `describeSketch` |
| P2.4 | model_1 generate~ (r15_1) | `models.ts` `model1GenerateFromSketch` (`POST /api/model1/generate-from-sketch`) |
| P3.1 | human specify (r18_1) | `CollageMode.tsx` draw tool |
| P3.2 | human modify (r18_2) | `CollageMode.tsx` move / resize tool |
| P3.3 | human specify (r19_1) | `src/components/VoiceRecorder.tsx` |
| P3.4 | tool_3 translate (r20_1) | `tool3.ts` `transcriptToCategory` |
| P3.5 | tool_3 compose (r21_1) | `tool3.ts` `composeRecords` |
| P3.6 | model_2 generate~ (r22_1) | `models.ts` `model2Describe` (`POST /api/model2/describe`) |
| P3.7 | model_1 generate~ (r23_1) | `models.ts` `model1GenerateItem` (`POST /api/model1/generate-item`) |
| P3.8 | tool_3 compose (r24_1) | `tool3.ts` `composeCollage` |

Representation types (r1–r24) are in `src/shared/types.ts`. See `PLAN.md` for the full mapping and `NOTES.md` for decisions the design left open.
