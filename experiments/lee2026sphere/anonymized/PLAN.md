# PLAN — System X

The design (`design.json`) has no goal, no descriptions, no representation descriptions,
no references, and no images. Identifiers are opaque (`r1`…`r31`). Everything below
about *what* each representation contains is therefore inferred from roles, media,
actors, operations and the data flow. The default interpretation (taken without waiting
for confirmation, per the experiment instructions):

> **A text-to-scene composer.** A user describes a scene in words (r1). The system retrieves
> assets from a library (r2) using an embedding (r4), has models rerank and assign them to
> the request, using a learned reliability model (r3), lays them out with a deterministic
> layout engine and shows a 2D top-down scene (r14). The user then edits the scene by
> selecting objects/regions on the canvas and **speaking** a command (process 2).
> Finally, a "learn" pass (process 3) mines reusable arrangements from the edited scene,
> has a model describe them as new composite library assets (r2 → r2_2), renders them,
> has a model judge them, and updates the reliability model (r3 → r3_2).

## Stack

- Node 20, TypeScript everywhere.
- Backend: Express (`server/`), run with `tsx`. JSON file persistence in `data/`.
- Frontend: React + Vite (`web/`), SVG canvas for the spatial scene. No UI library.
- Model provider: one function `callModel()` in `server/llm.ts` that shells out to
  `claude -p --output-format json` with `CLAUDECODE` removed from the env.
- Speech-to-text (model_1): Claude cannot transcribe audio, so model_1 is the browser's
  Web Speech API (a speech model) with a typed fallback; the raw audio is still recorded.

## Representations

| id | role medium | contents (inferred) | file |
|---|---|---|---|
| r1 | instruction language | scene request text | `web/src/App.tsx` state `request` |
| r2 | artifact record | asset library: `{version, assets: Asset[]}` | `server/library.ts`, `data/library.json` |
| r3 | artifact record | reliability model: `{version, weights: {assetId: number}, bias, history}` | `server/reliability.ts`, `data/reliability.json` |
| r4 | artifact numeric | request embedding: 16-dim vector over fixed concept axes | `server/process1.ts` |
| r5 | selection record* | retrieved candidates `{assetId, similarity}` (top-K) | `server/process1.ts` |
| r6 | artifact tabular | rerank table: `assetId, relevance 0–10, reason` | `server/process1.ts` |
| r7 | selection record* | shortlisted candidates (relevance ≥ threshold) | `server/process1.ts` |
| r8 | artifact tabular | slot assignment table: `slot, assetId, count, confidence` | `server/process1.ts` |
| r9 | selection record* | chosen asset per slot (confidence × reliability) | `server/process1.ts` |
| r10 | instruction record | placement request: instances with footprints | `server/sceneEngine.ts` |
| r11 | artifact record | scene record: id, title, room size, request, created | `shared/types.ts` |
| r12 | instruction record | layout spec: instances + spatial hints parsed from r1 | `server/sceneEngine.ts` |
| r13 | artifact graph | scene graph: room → objects, relation edges | `server/sceneEngine.ts` |
| r14 | artifact spatial | placed objects `{id, assetId, x, y, w, h, rot, color}` | `shared/types.ts` |
| r15 | artifact record | view/scene metadata: viewport, edit log | `shared/types.ts` |
| r16 | selection spatial | selected object ids + optional rectangle region | `web/src/SceneCanvas.tsx` |
| r17 | instruction audio | recorded voice command (WebM blob) | `web/src/VoiceInput.tsx` |
| r18 | instruction language | transcript of r17 | `web/src/VoiceInput.tsx` |
| r19 | instruction record | composed command `{utterance, selection, sceneSummary}` | `server/process2.ts` |
| r20 | instruction record | interpreted intent `{action, targets, parameters, explanation}` | `server/process2.ts` |
| r21 | instruction record* | atomic edit ops `{op, target, args}` | `server/process2.ts` |
| r22 | artifact record | scene snapshot (r14+r15+r11) | `server/process3.ts` |
| r23 | artifact tabular | object table: id, asset, x, y, w, h, color | `server/process3.ts` |
| r24 | artifact graph | proximity relation graph between objects | `server/process3.ts` |
| r25 | artifact graph | arrangement subgraphs (connected groups ≥ 2) | `server/process3.ts` |
| r26 | artifact graph | groups expanded by model with names / functions / edge relations | `server/process3.ts` |
| r27 | artifact language* | descriptions of new composite assets | `server/process3.ts` |
| r28 | artifact record* | new composite asset records | `server/process3.ts` |
| r29 | artifact visual | SVG thumbnails of new assets | `server/render.ts` |
| r30 | evaluation categorical* | verdict per new asset: accept / revise / reject | `server/process3.ts` |
| r31 | evaluation numeric* | numeric score per asset | `server/process3.ts` |

## Transformations

| process | step | actor op | implementation |
|---|---|---|---|
| 1 | r1 → r4 | model_3 translate | `embedRequest()` (Claude rates 16 axes) |
| 1 | r4,r2 → r5 | tool_3 match | `retrieve()` cosine top-K |
| 1 | r1,r4,r5 → r6 | model_4 match | `rerank()` |
| 1 | r6 → r7 | tool_3 select | `shortlist()` |
| 1 | r1,r7,r3 → r8 | model_5 match | `assignSlots()` |
| 1 | r8 → r9 | tool_3 select | `chooseAssets()` |
| 1 | r9 → r10,r11 | tool_1 generate | `generatePlacementRequest()` |
| 1 | r1,r10,r9 → r12 | tool_3 compose | `composeLayoutSpec()` |
| 1 | r12 → r13 | tool_1 generate | `generateSceneGraph()` (layout solver) |
| 1 | r13 → r14,r15 | tool_2 translate | `graphToLayout()` |
| 2 | → r16 | human select | click / shift-click / drag-rectangle on SVG canvas |
| 2 | → r17 | human specify | hold-to-talk microphone button |
| 2 | r17 → r18 | model_1 translate | Web Speech API (fallback: type text) |
| 2 | r16,r18 → r19 | tool_2 compose | `composeCommand()` |
| 2 | r19 → r20 | model_2 translate~ | `interpretCommand()` |
| 2 | r20 → r21* | model_2 decompose~ | `decomposeIntent()` |
| 2 | r21* → r14 | tool_2 execute | `executeOps()` — loop back to the editable scene; undo history kept |
| 3 | r14,r15,r11 → r22 | tool_4 compose | `snapshotScene()` |
| 3 | r22 → r23 | tool_4 extract | `objectTable()` |
| 3 | r23 → r24 | tool_4 assign | `assignRelations()` |
| 3 | r24 → r25 | tool_4 extract | `extractGroups()` |
| 3 | r25 → r26 | model_6 expand~ | `expandGroups()` |
| 3 | r26 → r27* | model_6 extract~ | `describeAssets()` |
| 3 | r27* → r28* | tool_4 translate | `toAssetRecords()` |
| 3 | r28*,r2 → r2_2 | tool_4 compose | `mergeLibrary()` |
| 3 | r2_2 → r29 | tool_2 translate | `renderThumbnails()` |
| 3 | r29,r2_2,r11 → r30* | model_7 evaluate | `judgeAssets()` |
| 3 | r30* → r31* | tool_5 evaluate | `scoreVerdicts()` |
| 3 | r31*,r3 → r3_2 | tool_5 train | `trainReliability()` |

## Triggers (no descriptions in the design; chosen defaults)

- Process 1: "Compose scene" button after typing r1.
- Process 2: repeats any number of times on the scene produced by process 1.
- Process 3: "Learn from this scene" button, available after process 1 (with or without process 2 edits).

## Open choices with defaults taken

- Model provider: Claude Code CLI (`sonnet` by default, `CLAUDE_MODEL` env overrides).
- Persistence: JSON files in `data/` (library, reliability model, scenes).
- Layout: three-column app — left: request + pipeline trace; center: scene canvas + voice bar; right: library / learning panel.
- Every intermediate representation is shown in a collapsible "pipeline trace" so each step is inspectable.
- Images: none in the design.
