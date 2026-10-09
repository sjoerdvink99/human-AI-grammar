# NOTES: decisions the design did not determine

The design fixes the processes, actors, operations, representation names and one-line contents. It also says what kind of model each actor is. Everything below is my choice.

## Stack and libraries
- **One TypeScript package**: an Express backend run with `tsx`, and a Vite + vanilla TS frontend. No UI framework; the UI is small and mostly renders step results.
- **three.js** for the VR runtime (tool_2), with `VRButton` for WebXR, `OrbitControls` for desktop, and `CSS2DRenderer` for labels.
- **zod** validates every generative output, plus checks against the scene (ids, catalog types, colour names).
- **@huggingface/transformers** runs two local models in Node:
  - `Xenova/all-MiniLM-L6-v2` for model_3. If it fails to load, a hashed character-trigram embedding stands in.
  - `Xenova/whisper-tiny.en` for model_1.
- **Claude Code CLI** (`claude -p --output-format json --json-schema … --tools ""`, `CLAUDECODE` removed from env) for model_2, model_6 and model_7, all through `callModel()` in `server/llm.ts`. model_7 gets the `Read` tool so it can open the PNG; that is how the CLI sees images. Each call gets one retry on invalid output.
- **vitest** for tests. The tests cover the solver, request parsing, grounding, the policy-gradient check against finite differences, training direction, and edit ops.
- **Port 8791** for the API, because 8787 was taken on this machine.

## Data formats
- **Coordinates**: x runs west→east and z runs north→south, in metres, with the origin at the north-west corner. Rotation is in degrees, 0 means the front faces +z (south), and it increases toward east. Each room has one door on the south wall and a window on the north wall, plus an east window when the request says "bright", "sunny" and so on.
- **Object catalog**: 25 types with fixed sizes, colours, function tags and aliases (`shared/catalog.ts`), plus room templates for 8 room types. All objects are boxes; there are no 3D assets.
- **scene_graph**: room + objects + relations (`against_wall`, `near`, `facing`, `on`, `near_window`). **scene** is that graph rendered in three.js; the edited graph is kept as the scene state.
- **Spatial constraint vocabulary** (8 kinds): `near`, `far_from`, `facing`, `against_wall`, `near_window`, `in_corner`, `centered`, `away_from_door`. Each has a weight and a source (`default`, `retrieved`, `request`).
- **Affordances** must follow 8 sentence templates ("Place the <object> near the <object>.", …), optionally followed by "because …". tool_4 parses them with regexes. Statements it can't parse are reported in the UI and not stored, so the "rules a layout generator can use" requirement is enforced where the constraints are produced.
- **preference_memory**: a list of past scenes. Each holds the request, its embedding as the retrieval key, the room, its object types, and its affordances (statement + constraint + key). The scene key is the session's `query_embedding`, taken from the retrieval trace, because process 3 has no embedding step.
- **retrieval_policy**: temperature 1.0, 8 candidates, 2 sampled scenes, 4 sampled preferences, learning rate 0.05, a reward baseline, two LoRA rerankers (rank 4, alpha 10), and an update history.
- **retrieval_trace**: the query and candidate keys and the chosen ids, in sampling order, so tool_5 can recompute log-probabilities. It is saved per session in `data/sessions/`.
- **targets**: an ordered list of objects or floor positions. **edit_subtasks** ops: `add`, `remove`, `move`, `rotate` (relative or absolute), `resize`, `recolor`.
- **realization_signals**: `realized` / `partial` / `not_realized`, mapped to rewards 1 / 0.5 / 0.
- **topdown_view**: a 2D canvas drawing (70 px per metre) of labelled rectangles with front triangles and coloured window and door segments, sent with a text legend. I drew it in 2D instead of taking an orthographic WebGL screenshot so the VLM can read the labels.

## Model and algorithm choices
- **model_4 / model_5**: single-query cross-attention scorers, `logit = alpha · qᵀ(I + ABᵀ)k`, with attention = softmax(logit / temperature). B starts at zero, the usual LoRA initialisation. With no training the rerankers rank by cosine similarity.
- **model_5 inputs**:
  - Query: the request embedding plus half the mean of the sampled scenes' keys.
  - Keys: the source scene key mixed with hashed token features of the statement (`affordanceKey`). Process 3 has no embedding step, so affordance statements are not embedded by model_3.
- **Affordance pool**: only the affordances stored with the sampled scenes. In the design, preference_memory is no longer in the state when model_5 runs.
- **tool_3 select**: Plackett–Luce sampling without replacement. This gives exploration for RL.
- **tool_5**: REINFORCE with per-step advantage `reward − baseline`. The baseline is an exponential moving average (0.8/0.2). Gradients are clipped to norm 1.
  - Scene reward: the mean reward of that scene's sampled affordances. A scene with none gets no update.
  - If nothing was retrieved (for example, empty memory), the policy is not updated and its version stays the same.
- **tool_1, room constraints**: deterministic keyword parsing.
  - Room type keywords and dimensions ("4 by 5 m"); size words scale the room.
  - Object mentions with counts and negation ("no tv").
  - Objects present in every sampled scene of the same room type are added.
  - A floor-area cap drops template extras before anything the user asked for.
  - With no room type in the request, it uses the top retrieved scene's type, else a living room.
- **tool_1, layout**: a seeded random-search solver (500 candidate poses per object, then 2 refinement passes). The cost combines weighted constraint penalties with overlap, door-clearance and window-blocking penalties. Anchor objects are placed first and rugs last. The seed is a hash of the session id.
- **tool_3 compose**: retrieved constraints get weight 3, defaults about 1. A retrieved pairwise rule adds its subject when its anchor is in the room, but never adds the anchor; otherwise a bedroom preference would put a bed into an office. Duplicate rules are merged.
- **tool_4 assign**: picks each object's function from its catalog tags by majority among nearby neighbours. Decor and lighting join their nearest functional neighbour. Objects then go through single-linkage clustering (2 m) within the same function.
- **tool_4 extract (geometric context)**: pairwise relations, zone adjacency (centroid < 2.8 m), and whether the straight path from the door to each zone is blocked.
- **Model prompts**: in `server/model2_editor.ts`, `server/model6_preferences.ts` and `server/model7_vlm.ts`.
  - model_2 translate: the scene list, the pointed targets in order, and the transcript. Pointed targets are matched to "this"/"there" in pointing order.
  - model_2 decompose: the operation vocabulary and catalog types. The output is filtered to existing ids and catalog types.
  - model_6 expand: the room → zone → object hierarchy. Ids are validated, and missing objects go into an "other" zone.
  - model_6 extract: 3–8 preferences in the fixed templates, weighted toward what the user edited.
  - model_7: one signal per retrieved affordance, judged from the image.

## Interaction, layout and styling
- **Three-column layout**: process 1 on the left, the 3D viewport in the middle, processes 2 and 3 on the right. Each step is a collapsible card tagged with its actor (purple for models, teal for tools) and its `input → output` representation names, so the whole pipeline can be inspected.
- **Desktop pointing**: click an object to point at it, click again to unpoint, Shift+click the floor for a position. Numbered orange badges show the pointing order.
- **Speech**: hold Space or the mic button. Audio is recorded with MediaRecorder, decoded and resampled to 16 kHz mono in the browser, and transcribed on the server. In WebXR, the trigger points and the grip records.
- **Typed fallback**: a typed command can replace the speech step. It is labelled "typed instead of spoken" and is **not in the design**; it exists for machines without a microphone. In that case model_1 does not run.
- **Process 3 trigger**: the *Finish editing & learn preferences* button, which is the design's "after editing ends". It is split into two streamed calls around the client-side top-down render, so the steps run in design order.
- **Step 1 results** are shown, and model output goes straight to execution, as the design says. There is no human review or undo step, because the design has none. A failed round leaves the scene unchanged and asks the user to speak again.
- **Memory & policy inspector** dialog, a reward-history sparkline, and a **Reset learning** button, which deletes the current memory and policy files.
- **Persistence**: JSON files in `data/`, with every memory and policy version kept in `data/history/`.
- **Memory starts empty**: the first session generates from templates, and personalisation starts with the second session.
- **Styling**: light neutral palette, system font. Walls face inward so the walls toward the camera are see-through.

## Verified
- `npm run typecheck`, `npm test` (7 tests) and `npm run build` pass.
- Headless Chromium drove the real UI through all three processes in three sessions: generate → point + command → finish → learn. The second and third sessions retrieved preferences from the earlier ones, model_7 judged them from the top-down PNG, and the policy went v1 → v2 → v3.
- The microphone path was tested in headless Chromium with a fake audio device playing a synthesised sentence: MediaRecorder → resample → Whisper → model_2 → execute.
- **Not tested**: a real WebXR headset. The controller code uses the standard three.js `select`/`squeeze` events.

## Did the design remind me of a specific published system?
Not of one system I can name with confidence. The full combination — LLM-driven VR indoor scene generation, speech + controller editing, preference memory built from finished scenes, and RL-trained cross-attention retrieval rerankers with LoRA — doesn't match a paper I know well enough to identify. Parts of it reminded me of known work, and some choices came from that knowledge rather than from the design:
- **Bolt's "Put-That-There" (1980)**, the classic speech + pointing interaction:
  - resolving "this"/"there" to pointed targets in pointing order;
  - the "move this there" example phrasing.
- **Holodeck (Yang et al., CVPR 2024)** and similar LLM-plus-constraint-solver scene generators:
  - a small vocabulary of relational layout constraints (near, against wall, facing, in corner, centred);
  - a search-based solver that places anchors first.
  These were not copied from any code.
- **General RL-for-retrieval practice**: REINFORCE with a moving baseline, Plackett–Luce sampling for stochastic top-k retrieval, and LoRA's zero-initialised B matrix. These are standard techniques, not tied to one system.

The rest comes from the design text or my own defaults: the affordance sentence templates, the zone heuristics, the top-down rendering and the reward mapping.
