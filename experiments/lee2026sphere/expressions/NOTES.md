# NOTES — decisions the design did not determine

The design gives three process expressions and nothing else: the goal, descriptions, representation descriptions,
references and images are all empty. Every decision below is mine. Where the design does fix something, the code
follows it literally. That covers every step, actor, operation, identifier and connection, the state contents (which
representations each prompt may use), `~` on the model_2 and model_6 steps, and the process 2 loop.

## Interpretation of the system

- **Domain.** I read `scene`, `scene_graph`, `room_constraints`, `affordances`, `functional_zones`, `topdown_view` and `targets: selection spatial`
  as an **interior room-layout** system: text request → furnished room → point-and-speak edits → learning from the result.
- **Triggers.** Process 1 runs on "Generate room". Process 2 runs once per spoken (or typed) command, and its loop back to
  the start state is the user issuing another command. Process 3 runs on "Finish session & learn". The design has no
  descriptions, so none of this is specified.
- **How the processes connect.** Processes 2 and 3 share `scene_1`, `retrieval_trace_1` and `interaction_log_1` from a server-side session.
  Process 3 writes `preference_memory_2` and `retrieval_policy_2`, which become the `preference_memory_1` and `retrieval_policy_1` of the next run of process 1.
  Earlier versions are kept in `data/*.history.json` and shown as a v1→v2 diff.
- **The scene keeps its identifier during editing.** The process 2 loop ends in `scene_1`, not `scene_2`. I still keep the earlier scenes in
  a per-session stack so the user can **Undo**. Undo is not a step in the design; I added it as the "review" affordance for a `~` output that is executed without a human check.

## Representations (content and format)

| id | choice |
| --- | --- |
| request | free text; room size is parsed with a regex ("4x5"), objects through a synonym table, and "no X" / "without X" exclude objects |
| query_embedding | **not a real embedding.** The Claude CLI has no embedding endpoint, so model_3 returns weights on 25 fixed semantic axes (room types, activities, styles, size). The vector is clipped and L2-normalised. Library scenes use the same axes, built from their tags |
| candidate_scenes | top-6 from the static library plus remembered user layouts, ranked by `w_embed·cos + w_pref·(pref−0.5) + w_value·value` |
| scored_scenes | table: sim, model_4 score, pref, learned value, total (+ model_4's reason) |
| sampled_scenes | 2 scenes, softmax sampling without replacement (temperature 0.08) |
| scored_affordances | table: text, constraint, source scene, model_5 score, learned value, total = score + w_value·value |
| sampled_affordances | best row per constraint key with total ≥ 0.35, up to 10 |
| room_constraints | `{room_type, width, depth, objects[{id,category}], requested, excluded}`. Object counts come from the union of the sampled scenes, trimmed to 45% floor coverage |
| generation_constraints | `{room, objects, constraints[]}`: selected affordances whose objects are present, plus low-weight "against wall" defaults from the catalog |
| scene_graph | `{room, nodes (objects with pose), edges (constraint relations with satisfied flag)}` |
| scene | metres, origin top-left, y down; each object has `{id, category, label, x, y, w, d, rot∈{0,90,180,270}, color, floor}`, and rot gives the direction the front faces |
| interaction_log | `{events[]}`: generated, edit (transcript, targets, point, resolved instruction, subtasks, report, rejected), undo |
| targets | `{object_ids[] in click order, point{x,y}}` |
| speech | the recorded audio Blob (MediaRecorder); it can be played back in the UI and is **not uploaded** (only its duration is logged) |
| interaction_state | `{transcript, targets[{id,category,x,y,rot}], point, selection_order}` |
| resolved_instruction | `{intent enum, referents[{phrase, object_id}], location{description,x,y}, parameters, explanation}` |
| edit_subtasks | `{op ∈ move/rotate/add/remove/resize/swap, object_id, other_id, category, x, y, dx, dy, rot, drot, scale, rationale}`; checked against the scene (unknown ids or categories are rejected and shown) |
| session_payload | `{session_id, request, scene, interaction_log, retrieval_trace}` |
| object_features | table: pose, size, wall distance, against-wall, corner, centre distance, edit count, status kept/added/removed (removed objects are recovered from the log) |
| functional_zones | catalog zone per category, split by single-link clustering (2 m), and adjacency edges between zones |
| geometric_context | graph: unary relations on nodes (against_wall, corner, centered), pairwise edges (near, beside, facing, around, under, far) |
| hierarchical_context | room → zones → groups, each with a purpose and relations (model_6 JSON) |
| affordances | 4–12 short sentences that name catalog categories and one relation word |
| spatial_constraints | `{type, a, b, params, key, text, parsed, observed}`; parameters are **measured on the final layout** |
| preference_memory | `{version, sessions, object_prefs{cat:weight}, constraints[{key,…,weight,count}], user_scenes[]}`. Weights decay by ×0.9 each session, and every finished layout becomes a retrievable "Your layout" scene |
| retrieval_policy | `{version, w_embed, w_llm, w_pref, w_value, temperature, k_candidates, n_scenes, scene_values{}, affordance_values{}, lr, episodes}` |
| topdown_view | PNG of the same plan renderer with object ids as labels, a 1 m grid and front-facing triangles, rendered in the browser at 900 px |
| realization_signals | `{key, signal ∈ realized/partial/violated/absent, note}` per sampled affordance |
| rewards | realized +1, partial +0.3, violated −1, absent −0.5 per affordance; each scene gets the mean of its affordances |

## Tools (deterministic code)

- **tool_1 generate (layout).** A greedy constraint solver: objects are placed in dependency order (targets first, larger
  first, rugs and mats last). Each object gets about 300 candidate poses (random, wall-snapped, and targeted rings or side positions near
  related objects), and the lowest-cost pose wins. Cost = near-hard collision penalty + out-of-bounds + weighted constraint violations.
  It is seeded from the session and request, so the result is reproducible.
- **tool_2 execute.** Applies the subtasks in order, clamps objects to the room, nudges them out of collisions (spiral search ≤ 1.5 m),
  and snaps rotation to 90°.
- **tool_4 translate.** Turns affordance sentences into constraint records by keyword matching for relations and objects, then measures
  the parameters on the final layout and records whether each relation actually holds there.
- **tool_5 train.** A bandit-style running-mean update of the scene and affordance values (lr 0.3). The mixing weights move along the
  correlation between each scoring feature and the scene reward, and the temperature decays by ×0.95.
- I invented the constraint vocabulary (against_wall, near, far, facing, beside, around, centered, corner, clearance, under), the 26-category
  furniture catalog with default sizes and colours, and the 15-scene library.

## Models (prompts and configuration)

- All model roles call `callModel()` in `server/llm.js` (Claude Code CLI, `--json-schema` structured output, tools disabled,
  `--no-session-persistence`, `CLAUDECODE` unset). Each role has its own system prompt and JSON schema, and the results are clamped and checked in code.
- model_3 (embedding axes), model_4 (scene reranker 0–1 with reason), model_5 (affordance fit 0–1), model_2 (two prompts: reference
  resolver and edit planner), model_6 (two prompts: hierarchy expansion and affordance extraction), model_7 (vision judge).
- **model_7 needs an image.** The PNG is written to a temp directory and the CLI is allowed to use only its `Read` tool to view it.
- **model_1 (speech → text) is not Claude.** The CLI cannot transcribe audio, so model_1 is the browser's Web Speech API
  (`createTranscriber()` in `public/speech.js`, swappable). If the browser has no speech recognition, a text box takes the command.
- All roles use the CLI's default model (override with `CLAUDE_MODEL`).
- Process 2 has no human review step after the `~` steps, so the subtasks run straight away. The resolved explanation, subtasks and rejected subtasks
  are shown in the Edits tab, and Undo reverts the change. Process 3's `~` outputs feed tools directly. They are shown, not reviewed.

## UI, layout, styling, libraries

- No dependencies: a Node `http` server and a vanilla ES-module frontend drawing on a 2D canvas (a top-down plan; no 3D).
- Three columns. Left: request, example chips, and the live **Pipeline** list of the current process with every `[actor op]`, `~` markers and
  expandable outputs. Centre: the room plan and the point-and-speak bar (selection chips, hold-to-speak button, editable transcript, Apply, Undo).
  Right: tabs for Retrieval (embedding axes, scored scenes and affordances with the sampled rows highlighted), Edits, Learn, and Memory & policy.
- Selection: click selects one object, shift/⌘-click adds or removes objects, a click on empty floor sets the location pin, Esc clears.
  When recognition returns text, the command is applied automatically on release.
- Visual style: warm neutral background, blue accent, a flat colour per category, a triangle marking each object's front.
- Steps stream to the browser as NDJSON. Persistence is JSON files under `data/`, and sessions are held in memory and mirrored to disk.
- Tests: `node --test` covers matching, sampling, request parsing, collision-free generation for every library scene, subtask
  execution and validation, and the whole process 3 tool chain. A headless-Chromium walkthrough exercised all three processes
  with real Claude calls (screenshots are in `docs/`).

## Known limitations

- The "embedding" is a model-scored concept vector, not a learned dense embedding.
- In-browser speech recognition depends on the browser (Chrome sends audio to Google's service). The headless walkthrough used the typed fallback.
- The model gives the edit planner absolute coordinates; tool_2 fixes collisions but not semantic mistakes.
- The library is small (15 scenes) and every room is a rectangle with no doors or windows.

## Did the design remind me of a published system?

I did not recognise one specific published system with all three processes: retrieval of scenes plus affordances under a
trained retrieval policy, point-plus-speech editing, and preference learning rewarded by a VLM. Parts of it resemble work I know, and some choices came from that knowledge rather than from the design:

- **LLM-driven 3D indoor scene synthesis (Holodeck, Yang et al., CVPR 2024; also LayoutGPT, I-Design, AnyHome).** These pair
  language models with a spatial-relation vocabulary and a constraint solver. From that line of work I took the *idea* of a small
  vocabulary of relational constraints (against wall, near/far, facing, beside, corner, centre, "around" for chairs and tables) and a
  greedy, candidate-sampling solver with collision as a hard cost. The design only says `[tool_1 generate]` from `generation_constraints`.
- **"Put-That-There" (Bolt, 1980)** and later multimodal VR/AR scene-editing work. These shaped how I read `targets` + `speech`
  → `[model_2 translate]` as *deictic reference resolution* ("this", "there", resolved by pointing order), and the
  example command "put this over there facing the sofa".
- **VLM-as-judge on top-down renders**, from recent layout-generation papers. These led me to label objects with ids and draw
  front-facing triangles in `topdown_view` so model_7 can check orientation relations. The design only says a visual view is evaluated.
- **Bandit-style retrieval policies.** These suggested the running-mean value updates with softmax-temperature sampling for `[tool_5 train]`.
  The design gives no algorithm.

Everything else came from the identifiers and structure of the expressions: zone assignment, hierarchical expansion,
affordance extraction, turning finished layouts into retrievable "your layout" scenes, and the reward scheme.
