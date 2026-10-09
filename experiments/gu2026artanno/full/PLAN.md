# PLAN — System X (cultural-meaning annotation with skill & knowledge reuse)

Design has no references and no images. The repository was empty, so a minimal stack is proposed
and (per experiment instructions) taken as the default without waiting.

## Stack (recommended default, accepted)
- Backend: Node 20 + Express (ES modules, plain JS, JSDoc types). No build step.
- Frontend: single-page vanilla JS + CSS served statically by Express (no bundler).
- Models: every `[model_n …]` step calls `callModel()` in `server/llm.js`, which spawns
  `claude -p --output-format json` with `CLAUDECODE` removed from the environment. One function = swappable provider.
- Validation of generative outputs: `zod` schemas, one retry with the validation error fed back.
- Image features (tool_3): `sharp` (colour histogram + 8×8 grayscale thumbnail + edge energy → vector).
- Text embeddings (tool_2): deterministic TF-IDF vectors over descriptions (local; no API key).
- Object detection (tool_1): no local detector is available; implemented as a vision call through the same
  provider (Claude reads the image file) constrained to a box/label JSON schema. Documented as a substitution.
- Persistence: JSON file `data/state.json` + images in `data/images/`. Earlier versions of skill library and
  knowledge base are kept (`history`).
- Tests: `node --test`.

## Representations

| id | type in code | contents | file |
|---|---|---|---|
| artworks | `Artwork[]` (`{id, file}`) image files | artwork images | server/store.js |
| artwork_metadata | `Artwork.metadata {title, period, origin, notes}` | catalog info | server/store.js |
| bounding_boxes | `Unit.box {x,y,w,h}` (0-1 normalised) | detected regions | server/process1.js |
| basic_labels | `Unit.basicLabel` (string from detector vocabulary) | object label per region | server/process1.js |
| artwork_descriptions | `Artwork.description` | whole-artwork text | server/process1.js |
| unit_descriptions | `Unit.description` | per-region text | server/process1.js |
| task | `Task.instruction` | which implicit meaning to label | server/tasks.js |
| skill_library | `state.skillLibrary.skills[]` `{id,name,applies_to,procedure[],cues[],version,parent}` | reusable skills | server/store.js |
| knowledge_base | `state.knowledgeBase.entries[]` `{concept,meaning,evidence,source}` | domain knowledge | server/store.js |
| label_taxonomy | tree `{label, children[]}` | label hierarchy | server/store.js |
| suggested_skills | `Task.suggestedSkills[] {skillId, reason}` (exactly ≤3) | suggestions | server/process2.js |
| chosen_skills | `Task.chosenSkills[] skillId` | user picks | server/tasks.js |
| text_embeddings | `Map unitId → number[]` | TF-IDF | server/embeddings.js |
| image_embeddings | `Map unitId → number[]` | image features | server/embeddings.js |
| clusters (1→2→3) | `Task.clusters[] {id,name,unitIds[]}` (v1 kept as `clustersInitial`) | groups of units | server/process2.js |
| cluster_patterns | `Cluster.pattern` | shared pattern | server/process2.js |
| label_scores | `Cluster.labelScores[] {label, score 0-1}` | label fit | server/process2.js |
| recommended_labels | `Cluster.recommendedLabels[]` (taxonomy leaves only, enforced) | recommendations | server/process2.js |
| recommendation_rationales | `Cluster.rationales {label → text}` | explanations | server/process2.js |
| cluster_priorities | `Cluster.priority {score, reason}` | inspection priority | server/process2.js |
| priority_clusters | `Task.priorityClusterIds[]` | put forward | server/process2.js |
| focused_cluster | UI state `ui.focusedCluster` | opened cluster | public/app.js |
| annotation_feedback | `Cluster.feedback[] {label, verdict: accept/reject/unsure, comment}` | judgement | public/app.js → server/process3.js |
| confirmed_labels (1→2) | `Task.confirmed {clusterId|unitId → label[]}` | accepted/corrected | server/process3.js |
| interaction_logs (1→2) | `Task.logs[]` `{t, kind, target, data}` | records | server/logs.js (tool_4) |
| chat_focus | `{type: artwork|cluster, id}` | asked-about item | public/app.js |
| question | text | user question | public/app.js |
| chat_answer | `{answer, comparisons[], suggested_labels[]}` | chatbot answer | server/process4.js |
| chat_decision | `{verdict, labels[], note}` | user decision | server/process4.js |
| mined_behaviors | `[{behavior, procedure, evidence}]` | from logs | server/process5.js |
| candidate_skills | skill records | new skills | server/process5.js |
| matching_skills | `[{candidateIdx, skillIds[]}]` | overlaps | server/process5.js |
| skill_differences | `[{candidateIdx, action: add/merge/branch, difference}]` | evaluation | server/process5.js |
| task_summary | text | learned | server/process6.js |

## Transformations (process order)

| process | step | function | file |
|---|---|---|---|
| 1 | tool_1 extract | `detectRegions` | server/process1.js |
| 1 | model_1 generate~ | `describeArtwork` | server/process1.js |
| 2/7 | model_2 select | `suggestSkills` | server/process2.js |
| 2/7 | human select | skill checkboxes → `POST /api/tasks/:id/skills` | public/app.js |
| 2 | tool_2 translate | `textEmbeddings` | server/embeddings.js |
| 2 | tool_3 translate | `imageEmbeddings` | server/embeddings.js |
| 2/7 | model_3 assign | `assignClusters` | server/process2.js |
| 2 | model_3 modify | `refineClusters` | server/process2.js |
| 2/7 | model_3 generate~ | `describePatterns` | server/process2.js |
| 2/7 | model_4 evaluate | `scoreLabels` | server/process2.js |
| 2/7 | model_4 select | `selectLabels` | server/process2.js |
| 2/7 | model_4 generate~ | `writeRationales` | server/process2.js |
| 2 | model_4 evaluate | `scorePriorities` | server/process2.js |
| 2 | model_4 select | `selectPriorityClusters` | server/process2.js |
| 3 | human select | cluster list click | public/app.js |
| 3 | human evaluate | accept/reject/unsure per label + comment | public/app.js |
| 3 | human assign | confirm labels (accepted + corrections from taxonomy) | public/app.js |
| 3 | tool_4 extract | `logs.extract` | server/logs.js |
| 4 | human select | "Ask about this" on image / cluster | public/app.js |
| 4 | human specify | chat input | public/app.js |
| 4 | model_5 generate~ | `chatAnswer` | server/process4.js |
| 4 | human evaluate | agree / disagree + note | public/app.js |
| 4 | human assign | edit labels for focus | public/app.js |
| 4 | tool_4 expand | `logs.expand` | server/logs.js |
| 5 | model_6 extract | `mineBehaviors` | server/process5.js |
| 5 | model_7 generate~ | `generateSkills` | server/process5.js |
| 5 | model_8 match | `matchSkills` | server/process5.js |
| 5 | model_8 evaluate | `diffSkills` | server/process5.js |
| 5 | model_8 modify~ | `updateLibrary` | server/process5.js |
| 6 | model_9 extract~ | `summarizeTask` | server/process6.js |
| 6 | model_10 modify | `integrateKnowledge` | server/process6.js |

Process 7 = the same task flow when a later task is created: uses the updated library/KB, runs only
model_2 select → human select → model_3 assign → model_3 generate → model_4 evaluate/select/generate
(no embeddings, no cluster refinement, no priorities — literally as in the design).

## Triggers
- P1: "Prepare" button in the Artworks panel (per artwork or all unprepared).
- P2/P7: create a task (text) → model_2 suggests 3 skills → user ticks skills → "Run analysis".
  First task uses the P2 pipeline; any task created after a learning run (library/KB v≥2) uses the P7 pipeline.
- P3: clicking a cluster in the (priority-ordered) cluster list.
- P4: "Ask" on an artwork card or cluster header opens the chat with that focus.
- P5 + P6: "Finish task & learn" button (after interactions are recorded); both run in parallel.

## Open choices (defaults taken)
- Provider: Claude Code CLI, model `sonnet` (override `CLAUDE_MODEL`).
- Sample data: 6 procedurally drawn SVG→PNG "artworks" with symbolic motifs + metadata, plus upload.
- Layout: three columns — left library/knowledge/taxonomy; centre task + clusters + review; right chat.
