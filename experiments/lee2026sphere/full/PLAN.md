# PLAN — System X (personalised VR indoor-scene authoring)

The plan was accepted with my own recommended defaults, as the experiment instructions require.

## Stack (empty repo → minimal stack)
- One npm package, TypeScript everywhere.
- **Backend**: Node 20 + Express (run with `tsx`). Holds every model step, the tool_1/3/4/5 tools and the JSON-file persistence.
- **Frontend**: Vite + vanilla TypeScript + three.js (WebXR `VRButton` for headsets, mouse/keyboard emulation of controllers on desktop). This is tool_2, the VR runtime.
- **Shared** (`shared/`): types, object catalog, geometry and edit operations, used by both sides.
- **Models**
  - model_2, model_6, model_7 (LLM/VLM): local Claude Code CLI (`claude -p --output-format json --json-schema …`, `CLAUDECODE` removed from env) behind one function `callModel()` in `server/llm.ts`.
  - model_3 (text embedding): `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`, run locally. Falls back to a hashed n-gram embedding if the model can't load.
  - model_1 (ASR): `Xenova/whisper-tiny.en` via `@huggingface/transformers` on the server. The browser records the mic, resamples to 16 kHz PCM and posts it. A typed command can stand in when no mic is available.
  - model_4 / model_5 (cross-attention rerankers): small bilinear cross-attention scorers with trainable LoRA matrices (A, B; rank 4), implemented in TS. Their weights live in `retrieval_policy`.
- **Persistence**: `data/preference_memory.json`, `data/retrieval_policy.json`, with every version kept under `data/history/`. Sessions (retrieval traces) go in `data/sessions/`.
- **Tests**: vitest (solver, parser, reranker gradient, edit ops). Type check: `tsc --noEmit`.

## Representations
| id | type | contents | file |
|---|---|---|---|
| request | `string` | user's text request | client `main.ts`, `shared/types.ts` |
| preference_memory | `PreferenceMemory {version, scenes: MemoryScene[]}`. Each scene holds its request, key embedding, room, objects and `affordances: MemoryAffordance[]` (statement + constraint) | `server/store.ts` |
| retrieval_policy | `RetrievalPolicy {version, temperature, kScenes, kAffordances, nCandidates, sceneReranker, affordanceReranker (LoRA A,B), baseline, lr, history}` | `server/store.ts` |
| query_embedding | `number[384]` (shown as a bar strip) | `server/model3_embedding.ts` |
| candidate_scenes | `MemoryScene[]` with cosine similarity | `server/tool3_retrieval.ts` |
| scored_scenes | table rows `{sceneId, request, cosine, rerankScore, prob}` | `server/rerankers.ts` |
| sampled_scenes | `MemoryScene[]` chosen by Plackett–Luce sampling | `server/tool3_retrieval.ts` |
| scored_affordances | table rows `{affordanceId, statement, sceneId, score, prob}` | `server/rerankers.ts` |
| sampled_affordances | `MemoryAffordance[]` | `server/tool3_retrieval.ts` |
| room_constraints | `{roomType, width, depth, height, windows, door, objectTypes}` | `server/tool1_scenegen.ts` |
| retrieval_trace | `{sessionId, request, queryEmbedding, scenes:{candidateIds, keys, chosen}, affordances:{candidates, keys, chosen}, policyVersion}` | `server/tool1_scenegen.ts` |
| generation_constraints | room + object list + `SpatialConstraint[]` (defaults + retrieved) | `server/tool3_retrieval.ts` (compose) |
| scene_graph | `{room, objects[], relations[]}` | `shared/types.ts` |
| scene | three.js scene built from the scene graph (client) | `client/vr.ts` |
| interaction_log | `{entries: {t, transcript, targets, subtasks, ok}[]}` | client `main.ts` |
| targets | ordered list of `{kind:'object',id}` or `{kind:'position',x,z}` | `client/vr.ts` |
| speech | recorded audio → 16 kHz Float32 PCM | `client/speech.ts` |
| transcript | `string` | `server/model1_asr.ts` |
| interaction_state | `{transcript, targets (resolved to object labels/coords), sceneSummary}` | `client/main.ts` (tool_2 compose) |
| resolved_instruction | `{command, references:[{phrase, target}]}` | `server/model2_editor.ts` |
| edit_subtasks | `EditSubtask[]` (add/remove/move/rotate/resize/recolor) | `server/model2_editor.ts`, `shared/editOps.ts` |
| session_payload | `{sessionId, request, scene, interactionLog}` | `server/tool4_context.ts` |
| object_features | table: id, type, size, position, rotation, wall distance, window distance, edited flags | `server/tool4_context.ts` |
| functional_zones | graph: zone nodes → object members | `server/tool4_context.ts` |
| geometric_context | graph: object-object relations + zone adjacency + door connectivity | `server/tool4_context.ts` |
| hierarchical_context | tree room → zones → objects with summaries | `server/model6_preferences.ts` |
| affordances | `string[]` using a fixed statement template | `server/model6_preferences.ts` |
| spatial_constraints | `SpatialConstraint[]` | `server/tool4_context.ts` |
| topdown_view | PNG rendered with an orthographic top camera | `client/vr.ts` |
| realization_signals | `'realized' \| 'partial' \| 'not_realized'` per retrieved affordance | `server/model7_vlm.ts` |
| rewards | `number[]` per retrieved affordance and scene | `server/tool5_optimizer.ts` |

## Transformations
| process | actor op | function | file |
|---|---|---|---|
| 1 | model_3 translate | `embedRequest` | server/model3_embedding.ts |
| 1 | tool_3 match | `matchCandidateScenes` | server/tool3_retrieval.ts |
| 1 | model_4 match | `sceneReranker.score` | server/rerankers.ts |
| 1 | tool_3 select | `sampleScenes` | server/tool3_retrieval.ts |
| 1 | model_5 match | `affordanceReranker.score` | server/rerankers.ts |
| 1 | tool_3 select | `sampleAffordances` | server/tool3_retrieval.ts |
| 1 | tool_1 generate | `generateRoomConstraints` (+ trace) | server/tool1_scenegen.ts |
| 1 | tool_3 compose | `composeGenerationConstraints` | server/tool3_retrieval.ts |
| 1 | tool_1 generate | `generateSceneGraph` (constraint solver) | server/tool1_scenegen.ts |
| 1 | tool_2 translate | `VRRuntime.loadSceneGraph` | client/vr.ts |
| 2 | human select | controller/mouse pick → `targets` | client/vr.ts |
| 2 | human specify | hold-to-talk mic | client/speech.ts |
| 2 | model_1 translate | `transcribe` | server/model1_asr.ts |
| 2 | tool_2 compose | `composeInteractionState` | client/main.ts |
| 2 | model_2 translate~ | `resolveReferences` | server/model2_editor.ts |
| 2 | model_2 decompose~ | `decomposeEdit` | server/model2_editor.ts |
| 2 | tool_2 execute | `executeSubtasks` | shared/editOps.ts (client) |
| 3 | tool_4 compose | `composeSessionPayload` | server/tool4_context.ts |
| 3 | tool_4 extract | `extractObjectFeatures` | server/tool4_context.ts |
| 3 | tool_4 assign | `assignFunctionalZones` | server/tool4_context.ts |
| 3 | tool_4 extract | `extractGeometricContext` | server/tool4_context.ts |
| 3 | model_6 expand~ | `expandHierarchicalContext` | server/model6_preferences.ts |
| 3 | model_6 extract~ | `extractAffordances` | server/model6_preferences.ts |
| 3 | tool_4 translate | `groundAffordances` | server/tool4_context.ts |
| 3 | tool_4 compose | `composePreferenceMemory` | server/tool4_context.ts |
| 3 | tool_2 translate | `VRRuntime.renderTopdown` | client/vr.ts |
| 3 | model_7 evaluate | `evaluateRealization` | server/model7_vlm.ts |
| 3 | tool_5 evaluate | `computeRewards` | server/tool5_optimizer.ts |
| 3 | tool_5 train | `trainPolicy` (REINFORCE on LoRA) | server/tool5_optimizer.ts |

## Triggers
- Process 1 runs when the user submits a request. Submitting another request starts a new session and uses the latest memory and policy.
- Process 2 runs one round per spoken command and repeats until the user presses **Finish editing**.
- Process 3 runs on **Finish editing**: first the context/memory part, then the client renders the top-down view, then evaluation and training.

## Images
The design has none.

## Open choices (defaults taken)
See NOTES.md for the full list. In short: memory starts empty, desktop mouse emulates the controllers, the layout is three columns, and nothing gets a human review step the design doesn't have.
