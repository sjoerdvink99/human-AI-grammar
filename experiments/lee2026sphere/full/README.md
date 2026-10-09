# System X — personalised VR room authoring

This app is built from `design.json` (a Human-AI grammar design). It generates indoor scenes, lets you edit them by pointing and speaking (in a WebXR headset or with a mouse on desktop), and learns your spatial preferences after each session. Those preferences, plus a reinforcement-learned retrieval policy, personalise the next scene.

## Run

```bash
npm install
npm run dev        # API on :8791, UI on http://localhost:5173
# or: npm start    # production build served by the API on http://localhost:8791
npm run typecheck
npm test
```

Requirements:
- Node 20.
- The Claude Code CLI (`claude`) on `PATH` and logged in. It is used for model_2, model_6 and model_7.
- On first run, the local embedding and speech models (`Xenova/all-MiniLM-L6-v2`, `Xenova/whisper-tiny.en`) are downloaded into `data/models/`, about 60 MB.

Environment variables (all optional):

| variable | effect |
| --- | --- |
| `PORT` | API port |
| `DATA_DIR` | data directory |
| `CLAUDE_BIN` | path to the Claude CLI |
| `CLAUDE_MODEL` | model for the CLI calls, e.g. `sonnet` |
| `MODEL_TIMEOUT_MS` | timeout per model call |
| `EMBEDDING_MODEL` | local embedding model |
| `ASR_MODEL` | local speech recognition model |

Every generative model call goes through `callModel()` in `server/llm.ts`. To use another provider, replace that one function.

## Using it

1. **Generate**: describe a room ("a cosy bedroom with a reading corner and a desk") and press *Generate scene*. The left column shows every retrieval and generation step.
2. **Edit**: click objects to point at them, or Shift+click the floor to point at a position. Then hold **Space** or the mic button and speak ("move this there and turn it toward the window"). In a headset, use the controller trigger to point and the grip button to talk. Repeat as often as you like. A typed command can stand in for speech when no microphone is available.
3. **Learn**: press *Finish editing & learn preferences*. The system analyses the final scene, infers your preferences, stores them, checks which of the retrieved preferences ended up in the scene, and updates the rerankers.

Learned state lives in `data/preference_memory.json` and `data/retrieval_policy.json`. Every version is kept in `data/history/`. *Reset learning* deletes the current memory and policy.

## Design → code map

| process | step | code |
| --- | --- | --- |
| 1 | `[model_3 translate]` request → query_embedding | `embedRequest`, server/model3_embedding.ts |
| 1 | `[tool_3 match]` → candidate_scenes* | `matchCandidateScenes`, server/tool3_retrieval.ts |
| 1 | `[model_4 match]` → scored_scenes | `scoreKeys(policy.sceneReranker, …)`, server/rerankers.ts |
| 1 | `[tool_3 select]` → sampled_scenes* | `sampleScenes` (Plackett–Luce), server/tool3_retrieval.ts |
| 1 | `[model_5 match]` → scored_affordances | `scoreKeys(policy.affordanceReranker, …)`, server/rerankers.ts |
| 1 | `[tool_3 select]` → sampled_affordances* | `sampleAffordances`, server/tool3_retrieval.ts |
| 1 | `[tool_1 generate]` → room_constraints + retrieval_trace | `generateRoomConstraints`, `buildRetrievalTrace`, server/tool1_scenegen.ts |
| 1 | `[tool_3 compose]` → generation_constraints | `composeGenerationConstraints`, server/tool3_retrieval.ts |
| 1 | `[tool_1 generate]` → scene_graph | `generateSceneGraph` (constraint solver), server/tool1_scenegen.ts |
| 1 | `[tool_2 translate]` → scene | `VRRuntime.loadSceneGraph`, client/src/vr.ts |
| 2 | `[human select]` → targets | `VRRuntime.pick` (mouse / XR controller), client/src/vr.ts |
| 2 | `[human specify]` → speech | `SpeechRecorder`, client/src/speech.ts |
| 2 | `[model_1 translate]` → transcript | `transcribe` (Whisper), server/model1_asr.ts |
| 2 | `[tool_2 compose]` → interaction_state | `composeInteractionState`, client/src/main.ts |
| 2 | `[model_2 translate]~` → resolved_instruction | `resolveReferences`, server/model2_editor.ts |
| 2 | `[model_2 decompose]~` → edit_subtasks* | `decomposeEdit`, server/model2_editor.ts |
| 2 | `[tool_2 execute]` → scene, interaction_log (loop) | `executeSubtasks`, shared/editOps.ts |
| 3 | `[tool_4 compose]` → session_payload | `composeSessionPayload`, server/tool4_context.ts |
| 3 | `[tool_4 extract]` → object_features | `extractObjectFeatures`, server/tool4_context.ts |
| 3 | `[tool_4 assign]` → functional_zones | `assignFunctionalZones`, server/tool4_context.ts |
| 3 | `[tool_4 extract]` → geometric_context | `extractGeometricContext`, server/tool4_context.ts |
| 3 | `[model_6 expand]~` → hierarchical_context | `expandHierarchicalContext`, server/model6_preferences.ts |
| 3 | `[model_6 extract]~` → affordances* | `extractAffordances`, server/model6_preferences.ts |
| 3 | `[tool_4 translate]` → spatial_constraints* | `groundAffordances`, server/tool4_context.ts |
| 3 | `[tool_4 compose]` → preference_memory_2 | `composePreferenceMemory`, server/tool4_context.ts |
| 3 | `[tool_2 translate]` → topdown_view | `VRRuntime.renderTopdown`, client/src/vr.ts |
| 3 | `[model_7 evaluate]` → realization_signals* | `evaluateRealization`, server/model7_vlm.ts |
| 3 | `[tool_5 evaluate]` → rewards* | `computeRewards`, server/tool5_optimizer.ts |
| 3 | `[tool_5 train]` → retrieval_policy_2 | `trainPolicy` (REINFORCE on LoRA), server/tool5_optimizer.ts |

API routes, in `server/index.ts`:

| route | runs |
| --- | --- |
| `POST /api/scenes` | process 1 |
| `POST /api/transcribe` | model_1 |
| `POST /api/edit/resolve` | model_2 translate |
| `POST /api/edit/decompose` | model_2 decompose |
| `POST /api/learn/context` | process 3 up to preference_memory_2 (NDJSON stream) |
| `POST /api/learn/evaluate` | model_7, tool_5 evaluate, tool_5 train (NDJSON stream) |

See `PLAN.md` for the representation table and `NOTES.md` for the decisions the design left open.
