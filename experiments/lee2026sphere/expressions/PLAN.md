# PLAN — System X

The design has no goal, descriptions, references, or images. From the identifiers I read it as:
**a text-to-room-layout system** that (1) retrieves example scenes and spatial affordances using a learned
retrieval policy and the user's preference memory, then procedurally generates a furnished room;
(2) lets the user edit the room by pointing at objects and speaking a command; and (3) at session end,
learns from the final room: it extracts the user's spatial preferences into memory and trains the retrieval
policy from a vision-model check of which retrieved affordances were realized.

Defaults taken without waiting for confirmation (per experiment instructions).

## Stack

- Node 20, zero npm dependencies. `node:http` server (`server/`), vanilla ES-module frontend (`public/`), 2D canvas.
- Model steps: one function `callModel()` in `server/llm.js` that spawns `claude -p --output-format json --json-schema …`
  with `CLAUDECODE` removed from the environment. Swap provider there.
- Persistence: JSON files in `data/` (scene library is static in `server/sceneLibrary.js`; memory, policy, sessions persisted).
- Tests: `node --test` over the deterministic tools.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| request | string | user's room description | public/app.js, server/process1.js |
| preference_memory (v1→v2) | record `PreferenceMemory` | `{sessions, object_prefs{category:weight}, constraints[], user_scenes[]}` | data/preference_memory.json, server/process3.js |
| retrieval_policy (v1→v2) | record `RetrievalPolicy` | `{w_embed, w_llm, w_pref, temperature, k_candidates, n_scenes, n_affordances, scene_values{}, affordance_values{}, lr, episodes}` | data/retrieval_policy.json, server/policy.js |
| query_embedding | number[24] | model-produced vector over fixed semantic axes (`AXES`) | server/embedding.js |
| candidate_scenes | SceneRef[] | top-k library/user scenes by cosine + preference boost | server/process1.js |
| scored_scenes | table rows `{scene_id, name, sim, llm_score, pref, value, total}` | server/process1.js |
| sampled_scenes | SceneRef[] | softmax-sampled by policy | server/process1.js |
| scored_affordances | table rows `{key, text, constraint, source_scene, llm_score, value, total}` | server/process1.js |
| sampled_affordances | Affordance[] | selected above threshold / top-n | server/process1.js |
| room_constraints | record `{room_type, width, depth, objects[{id,category}]}` | server/generator.js |
| retrieval_trace | record `{request, query_embedding, candidates, scored_scenes, sampled_scenes, scored_affordances, sampled_affordances}` | server/process1.js |
| generation_constraints | record `{room, objects, constraints[]}` | server/generator.js |
| scene_graph | graph `{nodes[obj], edges[{a,b,type}]}` | server/generator.js |
| scene | spatial `{room{width,depth}, objects[{id,category,label,x,y,w,d,rot,color}]}` | server/scene.js, public/canvas.js |
| interaction_log | record `{events[]}` | server/process2.js |
| targets | spatial selection `{object_ids[], point{x,y}}` | public/app.js |
| speech | audio Blob (MediaRecorder) | public/speech.js |
| transcript | string | public/speech.js (Web Speech API) |
| interaction_state | record `{transcript, targets[{id,category,x,y}], point, scene_summary}` | server/process2.js |
| resolved_instruction | record `{intent, referents[], location, parameters, explanation}` | server/process2.js |
| edit_subtasks | record[] `{op: move|rotate|add|remove|resize|swap, object_id, category, x, y, rot, dx, dy, ...}` | server/process2.js |
| session_payload | record `{scene, interaction_log, retrieval_trace}` | server/process3.js |
| object_features | table rows `{id, category, x, y, rot, w, d, wall_dist, edited}` | server/analysis.js |
| functional_zones | graph `{zones[{id,name,objects[]}], edges}` | server/analysis.js |
| geometric_context | graph `{nodes, edges[{a,b,relation,distance}]}` | server/analysis.js |
| hierarchical_context | graph `{room, zones[{name, purpose, groups[{name, objects[], relations[]}]}]}` | server/process3.js |
| affordances | string[] | server/process3.js |
| spatial_constraints | record[] `{type, a, b, params, text}` | server/analysis.js |
| topdown_view | PNG data URL (rendered client-side by the same renderer) | public/canvas.js |
| realization_signals | `{key, signal: realized|partial|violated}`[] | server/process3.js |
| rewards | number[] | server/policy.js |

## Transformations

| # | step | implementation |
| --- | --- | --- |
| P1 | [model_3 translate] request → query_embedding | `embedRequest()` server/embedding.js |
| P1 | [tool_3 match] | `matchCandidates()` server/process1.js |
| P1 | [model_4 match] | `scoreScenes()` server/process1.js |
| P1 | [tool_3 select] scenes | `sampleScenes()` server/policy.js |
| P1 | [model_5 match] | `scoreAffordances()` server/process1.js |
| P1 | [tool_3 select] affordances | `selectAffordances()` server/policy.js |
| P1 | [tool_1 generate] room constraints + trace | `generateRoomConstraints()` server/generator.js |
| P1 | [tool_3 compose] | `composeGenerationConstraints()` server/generator.js |
| P1 | [tool_1 generate] scene graph | `generateSceneGraph()` (constraint solver) server/generator.js |
| P1 | [tool_2 translate] scene graph → scene | `sceneFromGraph()` server/scene.js |
| P2 | [human select] | click / shift-click / click floor on canvas, public/app.js |
| P2 | [human specify] | hold-to-talk button, public/speech.js |
| P2 | [model_1 translate] speech → transcript | browser Web Speech API (`transcribe()` public/speech.js); typed fallback |
| P2 | [tool_2 compose] | `composeInteractionState()` server/process2.js |
| P2 | [model_2 translate]~ | `resolveInstruction()` server/process2.js |
| P2 | [model_2 decompose]~ | `decomposeInstruction()` server/process2.js |
| P2 | [tool_2 execute] | `executeSubtasks()` server/scene.js — loops back to the editing state |
| P3 | [tool_4 compose] | `composeSessionPayload()` server/process3.js |
| P3 | [tool_4 extract] features | `extractObjectFeatures()` server/analysis.js |
| P3 | [tool_4 assign] zones | `assignZones()` server/analysis.js |
| P3 | [tool_4 extract] geometry | `extractGeometricContext()` server/analysis.js |
| P3 | [model_6 expand]~ | `expandHierarchy()` server/process3.js |
| P3 | [model_6 extract]~ | `extractAffordances()` server/process3.js |
| P3 | [tool_4 translate] | `affordancesToConstraints()` server/analysis.js |
| P3 | [tool_4 compose] memory | `updatePreferenceMemory()` server/process3.js |
| P3 | [tool_2 translate] top-down view | `renderTopDown()` public/canvas.js |
| P3 | [model_7 evaluate] | `evaluateRealization()` server/process3.js (image via Read tool) |
| P3 | [tool_5 evaluate] | `computeRewards()` server/policy.js |
| P3 | [tool_5 train] | `trainPolicy()` server/policy.js |

## Open choices (defaults taken)

- Triggers: P1 on "Generate room"; P2 on each select+speak; P3 on "Finish session & learn".
- 2D top-down canvas for the spatial scene (no 3D).
- Speech-to-text cannot run on Claude: model_1 is the browser Web Speech API, with a text box fallback.
- Embedding: Claude cannot emit real embeddings, so model_3 outputs a 24-axis semantic vector.
- Model: Claude CLI default model for all model roles; each role has its own system prompt.
- Generative steps (`~`) in P2 run then execute automatically; every execute is undoable and listed in the log.
