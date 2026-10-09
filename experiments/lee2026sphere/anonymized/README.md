# System X — scene composer

An implementation of the Human-AI grammar design in `design.json`, read as a **text-to-scene composer with voice editing and library learning** (see `PLAN.md` for that reading and `NOTES.md` for every decision the design left open).

1. **Compose** (process 1): describe a room. The system embeds the request, retrieves assets, has two model passes rerank and assign them to slots, then lays them out on a 2D floor plan.
2. **Edit by voice** (process 2): select objects (click, shift-click, or drag a region), then hold the mic and speak, or type. A model interprets the command and breaks it into edit operations, and the engine applies them. Repeat as often as you like; Undo is available.
3. **Learn** (process 3): mines groups of adjacent objects from the plan. A model names and describes them as composite library assets, renders them, and judges them. The asset reliability model is then retrained, which affects later compositions.

## Run

```bash
npm install
npm run dev        # server on :3001 + Vite on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:3001
npm test           # deterministic tests (model mocked with MOCK_MODEL=1)
npm run typecheck
```

Model steps call the local Claude Code CLI (`claude -p --output-format json`, with `CLAUDECODE` removed from the environment) through one function, `callModel()` in `server/llm.ts`. `CLAUDE_MODEL` selects the model (default `sonnet`). Voice transcription uses the browser's Web Speech API (Chrome/Edge/Safari). In other browsers the audio is still recorded, and you type the transcript.

Data (the asset library and the reliability model) is stored in `data/*.json`. Use "reset library" in the header to return to the seed state.

## Design → code

| Process | Transformation | Code |
|---|---|---|
| 1 | `[model_3 translate]` r1 → r4 | `embedRequest()` `server/process1.ts` |
| 1 | `[tool_3 match]` r4 + r2 → r5* | `retrieve()` `server/process1.ts` |
| 1 | `[model_4 match]` → r6 | `rerank()` `server/process1.ts` |
| 1 | `[tool_3 select]` r6 → r7* | `shortlist()` `server/process1.ts` |
| 1 | `[model_5 match]` r1 + r7 + r3 → r8 | `assignSlots()` `server/process1.ts` |
| 1 | `[tool_3 select]` r8 → r9* | `chooseAssets()` `server/process1.ts` |
| 1 | `[tool_1 generate]` r9 → r10 + r11 | `generatePlacementRequest()` `server/sceneEngine.ts` |
| 1 | `[tool_3 compose]` → r12 | `composeLayoutSpec()` `server/sceneEngine.ts` |
| 1 | `[tool_1 generate]` r12 → r13 | `generateSceneGraph()` `server/sceneEngine.ts` |
| 1 | `[tool_2 translate]` r13 → r14 + r15 | `graphToLayout()` `server/sceneEngine.ts` |
| 2 | `[human select]` → r16 | `SceneCanvas` `web/src/SceneCanvas.tsx` |
| 2 | `[human specify]` → r17 | hold-to-talk in `VoiceInput` `web/src/VoiceInput.tsx` |
| 2 | `[model_1 translate]` r17 → r18 | Web Speech API in `VoiceInput` |
| 2 | `[tool_2 compose]` r16 + r18 → r19 | `composeCommand()` `server/sceneEngine.ts` |
| 2 | `[model_2 translate]~` r19 → r20 | `interpretCommand()` `server/process2.ts` |
| 2 | `[model_2 decompose]~` r20 → r21* | `decomposeIntent()` `server/process2.ts` |
| 2 | `[tool_2 execute]` r21* → r14 | `executeOps()` `server/sceneEngine.ts` |
| 3 | `[tool_4 compose]` → r22 | `snapshotScene()` `server/process3.ts` |
| 3 | `[tool_4 extract]` → r23 | `objectTable()` |
| 3 | `[tool_4 assign]` → r24 | `assignRelations()` |
| 3 | `[tool_4 extract]` → r25 | `extractGroups()` |
| 3 | `[model_6 expand]~` → r26 | `expandGroups()` |
| 3 | `[model_6 extract]~` → r27* | `describeAssets()` |
| 3 | `[tool_4 translate]` → r28* | `toAssetRecords()` |
| 3 | `[tool_4 compose]` → r2_2 | `mergeLibrary()` |
| 3 | `[tool_2 translate]` → r29 | `renderThumbnails()` `server/render.ts` |
| 3 | `[model_7 evaluate]` → r30* | `judgeAssets()` |
| 3 | `[tool_5 evaluate]` → r31* | `scoreVerdicts()` |
| 3 | `[tool_5 train]` → r3_2 | `trainReliability()` |

The left column of the UI shows a live **pipeline trace**: one row per transformation with its output representation, rendered by medium (bars for numeric, tables for tabular, outlines for graphs, thumbnails for visual, verdict badges for categorical).
