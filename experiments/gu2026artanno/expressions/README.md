# System X — artwork unit annotation with learned skills

A web app built from `design.json`, which uses the Human-AI grammar. A curator labels *units*, meaning bounding-box regions inside
artworks. Models describe the units, cluster them, recommend taxonomy labels and prioritise the review. The curator
reviews the clusters and chats with an assistant. The session's interaction logs are then mined to update a
**skill library** and a **knowledge base**, and the next task uses them.

## Run

```bash
npm install
npm start            # http://localhost:4317 (seeds a 12-artwork sample collection on first start)
npm test             # deterministic tools and validators
npm run check        # syntax check of all JS
npm run seed         # wipe data/ and regenerate the sample collection
```

Model steps call the local Claude Code CLI (`claude -p --output-format json --json-schema …`, with `CLAUDECODE`
removed from the environment). They all go through `callModel()` in `server/llm.js`. Configure with
`CLAUDE_MODEL` (default `sonnet`), `CLAUDE_CONCURRENCY` (4) and `CLAUDE_TIMEOUT_MS`. Set `PORT` to change the port.

## Using it

1. **Collection**: click *Describe collection* to run process 1. Click a box or a unit to highlight it. You can upload
   your own image with `{"objects":[{"label","bbox":[x,y,w,h]}]}` metadata.
2. **Task & clusters**: write a task and click *Suggest skills*. Adjust the pre-selected skills and run.
   *Exploratory* runs process 2. *With learned skills & knowledge* runs process 7.
3. **Review & chat**: work through the priority queue. Mark each unit ✓/✗/?. For ✗ you can pick a replacement label
   and write a comment. Then *Confirm labels*. The chat panel on the right asks the assistant about a cluster or unit.
   You accept or reject its suggestion.
4. **Learning**: *Learn skills & update knowledge* runs processes 5 and 6 on the logs that are new since the last round.
5. **Library**: browse every version of the skill library and the knowledge base, the taxonomy, and the confirmed labels.

## Design → code map

| Process | Step | Code |
|---|---|---|
| 1 | `[tool_1 extract]` metadata → bounding_boxes, basic_labels | `server/tools/extract.js` `tool1Extract` |
| 1 | `[model_1 generate]~` → artwork_descriptions, unit_descriptions | `server/processes/p1.js` `model1Describe` |
| 2, 7 | `[model_2 select]` → suggested_skills | `server/processes/p2.js` `model2SelectSkills` |
| 2, 7 | `[human select]` → chosen_skills | `public/app.js` `skillPicker` → `POST /api/runs/:id/start` |
| 2 | `[tool_2 translate]` → text_embeddings | `server/tools/embeddings.js` `tool2TextEmbed` |
| 2 | `[tool_3 translate]` → image_embeddings | `server/tools/embeddings.js` `tool3ImageEmbed` |
| 2, 7 | `[model_3 assign]` → clusters_1 / clusters_3 | `p2.js` `model3Assign` |
| 2 | `[model_3 modify]` → clusters_2 | `p2.js` `model3Refine` |
| 2, 7 | `[model_3 generate]~` → cluster_patterns | `p2.js` `model3Patterns` |
| 2, 7 | `[model_4 evaluate]` → label_scores | `p2.js` `model4ScoreLabels` |
| 2, 7 | `[model_4 select]` → recommended_labels | `p2.js` `model4RecommendLabels` |
| 2, 7 | `[model_4 generate]~` → recommendation_rationales | `p2.js` `model4Rationales` |
| 2 | `[model_4 evaluate]` → cluster_priorities | `p2.js` `model4Prioritize` |
| 2 | `[model_4 select]` → priority_clusters | `p2.js` `model4SelectPriority` |
| 3 | `[human select]` → focused_cluster | `public/app.js` `viewReview` (queue) |
| 3 | `[human evaluate]` → annotation_feedback | `public/app.js` `unitCard` (✓ ✗ ? + comment) |
| 3 | `[human assign]` → confirmed_labels_1 | `public/app.js` *Confirm labels* → `server/processes/p3.js` `commitReview` |
| 3 | `[tool_4 extract]` → interaction_logs_1 | `server/tools/logs.js` `tool4ExtractLogs` |
| 4 | `[human select]` → chat_focus | `public/app.js` `chatView` focus menu / *ask* buttons |
| 4 | `[human specify]` → question | `public/app.js` `chatView` question field |
| 4 | `[model_5 generate]~` → chat_answer | `server/processes/p4.js` `model5Answer` |
| 4 | `[human evaluate]` → chat_decision | `public/app.js` `chatMsg` accept/reject + note |
| 4 | `[human assign]` → confirmed_labels_2 | `p4.js` `decide` |
| 4 | `[tool_4 expand]` → interaction_logs_2 | `server/tools/logs.js` `tool4ExpandLogs` |
| 5 | `[model_6 extract]` → mined_behaviors | `server/processes/p5.js` `model6MineBehaviors` |
| 5 | `[model_7 generate]~` → candidate_skills | `p5.js` `model7CandidateSkills` |
| 5 | `[model_8 match]` → matching_skills | `p5.js` `model8Match` |
| 5 | `[model_8 evaluate]` → skill_differences | `p5.js` `model8Compare` |
| 5 | `[model_8 modify]~` → skill_library_2 | `p5.js` `model8UpdateLibrary` |
| 6 | `[model_9 extract]~` → task_summary | `server/processes/p6.js` `model9Summarize` |
| 6 | `[model_10 modify]` → knowledge_base_2 | `p6.js` `model10UpdateKB` + `applyKBOps` |

Orchestration and endpoints are in `server/index.js`. Persisted state, named after the design identifiers, is in
`server/store.js` (`data/state.json`). The planning notes are in `PLAN.md`, and the decisions the design left open are in `NOTES.md`.
