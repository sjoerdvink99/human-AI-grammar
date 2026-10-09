# System X — rooms from words

A web app built from the Human-AI grammar design in `design.json`:

1. **Generate**: describe a room. The app embeds the request, retrieves and reranks example scenes, samples scenes and
   spatial affordances with a learned retrieval policy, and lays out a furnished room with a constraint solver.
2. **Point and speak**: click objects and/or a floor spot on the plan, hold the mic button and say what to change
   ("put this over there facing the sofa"). A model resolves the references, splits the command into edit subtasks,
   and the app runs them. You can repeat this as often as you like, and undo.
3. **Finish session & learn**: the app pulls your spatial preferences out of the final room into a preference memory
   and trains the retrieval policy. The reward comes from a vision model checking which retrieved affordances the
   final top-down view actually shows.

## Run

```bash
npm start          # http://localhost:5173  (PORT=... to change)
npm test           # deterministic tools (node --test)
npm run check      # syntax check of all sources
```

Requirements: Node ≥ 20 and a logged-in `claude` CLI on the PATH. There are no npm dependencies.
Every model step goes through `callModel()` in `server/llm.js`, which runs `claude -p --output-format json --json-schema …`
with `CLAUDECODE` removed from the environment. Set `CLAUDE_MODEL` to choose a model and `CLAUDE_BIN` to point at a different binary.
For speech, use Chrome, Edge or Safari (Web Speech API). In other browsers, type the command in the box.
Learned state is written to `data/` (`preference_memory.json`, `retrieval_policy.json`, their `.history.json` versions, and the sessions).
"Reset learning" deletes the memory and the policy.

## Design → code

| Process | Step | Code |
| --- | --- | --- |
| 1 | `[model_3 translate]` request → query_embedding | `embedRequest` — server/embedding.js |
| 1 | `[tool_3 match]` → candidate_scenes* | `matchCandidates` — server/process1.js |
| 1 | `[model_4 match]` → scored_scenes | `scoreScenes` — server/process1.js |
| 1 | `[tool_3 select]` → sampled_scenes* | `sampleScenes` — server/policy.js |
| 1 | `[model_5 match]` → scored_affordances | `scoreAffordances` — server/process1.js |
| 1 | `[tool_3 select]` → sampled_affordances* | `selectAffordances` — server/policy.js |
| 1 | `[tool_1 generate]` → room_constraints + retrieval_trace | `generateRoomConstraints` — server/generator.js; trace built in `runProcess1` |
| 1 | `[tool_3 compose]` → generation_constraints | `composeGenerationConstraints` — server/generator.js |
| 1 | `[tool_1 generate]` → scene_graph | `generateSceneGraph` — server/generator.js |
| 1 | `[tool_2 translate]` → scene + interaction_log | `sceneFromGraph` — server/scene.js; drawn by `drawScene` — public/canvas.js |
| 2 | `[human select]` → targets | canvas click handler — public/app.js |
| 2 | `[human specify]` → speech | push-to-talk `createPushToTalk` — public/speech.js |
| 2 | `[model_1 translate]` → transcript | `createTranscriber` (Web Speech API) — public/speech.js |
| 2 | `[tool_2 compose]` → interaction_state | `composeInteractionState` — server/process2.js |
| 2 | `[model_2 translate]~` → resolved_instruction | `resolveInstruction` — server/process2.js |
| 2 | `[model_2 decompose]~` → edit_subtasks* | `decomposeInstruction` + `validateSubtasks` — server/process2.js |
| 2 | `[tool_2 execute]` → scene (loop) | `executeSubtasks` — server/scene.js |
| 3 | `[tool_4 compose]` → session_payload | `composeSessionPayload` — server/process3.js |
| 3 | `[tool_4 extract]` → object_features | `extractObjectFeatures` — server/analysis.js |
| 3 | `[tool_4 assign]` → functional_zones | `assignZones` — server/analysis.js |
| 3 | `[tool_4 extract]` → geometric_context | `extractGeometricContext` — server/analysis.js |
| 3 | `[model_6 expand]~` → hierarchical_context | `expandHierarchy` — server/process3.js |
| 3 | `[model_6 extract]~` → affordances* | `extractAffordances` — server/process3.js |
| 3 | `[tool_4 translate]` → spatial_constraints* | `affordancesToConstraints` — server/analysis.js |
| 3 | `[tool_4 compose]` → preference_memory_2 | `updatePreferenceMemory` — server/process3.js |
| 3 | `[tool_2 translate]` → topdown_view | `renderTopDown` — public/canvas.js |
| 3 | `[model_7 evaluate]` → realization_signals* | `evaluateRealization` — server/process3.js |
| 3 | `[tool_5 evaluate]` → rewards* | `computeRewards` — server/policy.js |
| 3 | `[tool_5 train]` → retrieval_policy_2 | `trainPolicy` — server/policy.js |

HTTP endpoints (`server/server.js`) stream each step as NDJSON, and the Pipeline panel shows them as they arrive:
`POST /api/generate` (process 1), `POST /api/sessions/:id/edit` and `/undo` (process 2), and
`POST /api/sessions/:id/learn` followed by `/evaluate` (process 3; in between, the browser renders the top-down view).

Screenshots from an automated walkthrough are in `docs/`. See `PLAN.md` for the representation tables and `NOTES.md` for every decision the design left open.
