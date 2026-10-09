# Paper → Video (System X)

Turns a research paper or long document into a short narrated, illustrated explainer video.
Built from the Human-AI grammar design in [`design.json`](design.json). The plan is in [PLAN.md](PLAN.md) and the open decisions are in [NOTES.md](NOTES.md).

## Run

Requirements: Node 20+, macOS (for the `say` speech synthesizer), the Claude Code CLI (`claude`) logged in, and optionally `pdftotext` for PDF upload.

```bash
npm install
npm run dev          # API on :3001, UI on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:3001
```

Environment variables: `CLAUDE_MODEL` (passed to `claude --model`, defaults to the CLI default), `MODEL_TIMEOUT_MS` (default 240000), `DATA_DIR` (default `./data`), `PORT` (default 3001).

Checks: `npm run typecheck`, `npm test`, and `node scripts/e2e-render.mjs <url> <chrome-executable>` (drives the Export tab in a real browser and renders a video).

## How it works

Five tabs: **Source → Concepts → Script → Scenes → Export**. Model calls run as background jobs. The UI polls `/api/project` and shows each intermediate result as it arrives. State is stored in `data/project.json`, and audio and images in `data/media/`.

Model providers live in one file, `server/provider.ts`:
- `callModel()` / `callModelJSON()` handle **model_1** (language). They run `claude -p --output-format json` with `CLAUDECODE` removed from the environment and validate JSON output with zod.
- `generateImage()` handles **model_2** (image). It uses the same CLI with a separate illustrator system prompt and returns a sanitized SVG.
- `synthesizeSpeech()` handles **model_3** (speech). It uses the macOS `say` voices, because the CLI cannot produce audio.

## Design → code map

| Process | Step | Code |
|---|---|---|
| 1 | `[model_1 extract]` r1 → r2* key points | `server/pipeline.ts` `extractKeyPoints` |
| 1 | `[model_1 generate]~` → r3* story angles | `generateAngles` |
| 1 | `[model_1 generate]~` → r4* pitches | `generatePitches` |
| 1 | `[model_1 evaluate]` → r5* scores | `evaluatePitches` (shown as bars in `ConceptsView`) |
| 1 | `[model_1 select]` → r6* shortlist | `selectPitches` |
| 1 | `[model_1 generate]~` → r7* concept records | `generateConcepts`, orchestrated by `POST /api/p1/run` |
| 2 | `[human select]` r7* → r8 | `ConceptsView` "Use this concept" → `POST /api/p2/select` |
| 2 | `[tool_1 compose]` → r9 clarify prompt | `server/tools.ts` `composeClarifyPrompt` |
| 2 | `[model_1 generate]~` → r10 questions | `generateQuestions` |
| 2 | `[human specify]` → r11 answers | `ScriptView` answer fields → `POST /api/p2/script` |
| 2 | `[model_1 compose]~` → r12 script | `composeScript` |
| 3 | `[human modify]` r8 | `ScriptView` `ConceptEditor` → `PUT /api/concept` |
| 4 | `[model_1 decompose]` → r13* scenes | `decomposeScript` (`POST /api/p4/plan`) |
| 4 | `[model_1 generate]~` → r14* visual prompts | `generateVisualPrompts` |
| 4 | `[human specify]` → r15 voice | `ScenesView` voice menu |
| 4 | `[model_3 generate]~` → r16* audio | `provider.synthesizeSpeech` via `voiceScene` (`POST /api/p4/produce`) |
| 4 | `[tool_1 extract]` → r17* durations | `tools.wavDuration` |
| 4 | `[model_2 generate]~` → r18* images | `provider.generateImage` via `drawScene` |
| 4 | `[tool_2 compose]` → r19* clips | `composeClip` |
| 5 | `[human select]` r20, `[human specify]` r21 | click a `SceneCard`, then pick a voice |
| 5 | model_3 → r22, tool_1 → r23, model_2 → r24, tool_2 → r25, `[tool_1 modify]` → r19 | `POST /api/p5/revoice` (`replaceScene`) |
| 6 | `[human modify]` r13 → r13_2 | `SceneCard` narration textarea |
| 6 | `[model_1 generate]~` r14_2, model_3 r26, tool_1 r27, model_2 r28, tool_2 r29, `[tool_1 modify]` | `POST /api/p6/edit` (`regenerateVisualPrompt` …) |
| 7 | `[tool_1 extract]` → r30 frame + r31* metadata | `POST /api/p7/prepare`, `tools.extractMetadata` |
| 7 | `[tool_1 compose]` → r32 title text | `tools.composeTitleText` |
| 7 | `[human modify]` r32 → r32_2 | `ExportView` title textarea |
| 7 | `[tool_1 compose]` → r33 title card | `tools.composeTitleImage` (`PUT /api/p7/title`) |
| 7 | `[human select]` → r34* clips | `ExportView` checkboxes and ↑/↓ order |
| 7 | `[human specify]` → r35 format | `ExportView` format buttons |
| 7 | `[tool_2 translate]` → r36 title clip | `client/src/render.ts` `translateTitle` |
| 7 | `[tool_2 compose]` → r37 video | `client/src/render.ts` `renderVideo` (Canvas + WebAudio + MediaRecorder) |

Earlier versions of each scene clip, from the loops in processes 5 and 6, are kept in `Scene.history` and can be compared under "Earlier versions".
