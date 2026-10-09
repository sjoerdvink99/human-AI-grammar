# PLAN — System X (artwork unit annotation with learned skills)

The design has no goal, description, representation notes, references or images. Everything below is
inferred from the seven expressions. Interpretation: a curator annotates *units* (regions given by
bounding boxes) inside a collection of artworks. An AI pipeline describes artworks and units, clusters
units, recommends taxonomy labels per cluster with rationales and prioritises clusters for review.
The human reviews clusters, confirms labels and chats with an assistant. Interaction logs are mined to
grow a **skill library** and a **knowledge base**, which a later task (process 7) uses.

## Stack (empty repo → proposed, default taken)

- Backend: Node 20, Express, ES modules, plain JavaScript (JSDoc). `sharp` for image rendering, cropping
  and pixel features; `multer` for uploads.
- Frontend: single page, vanilla JS + CSS served statically (no build step).
- Models: every model step goes through `callModel()` in `server/llm.js`, which runs
  `claude -p --output-format json --json-schema …` with `CLAUDECODE` removed from the environment.
- Persistence: `data/state.json` + `data/images/`. Versioned representations (skill library, knowledge
  base, clusters, confirmed labels, interaction logs) keep every version.
- Long model chains run as background jobs; the UI polls job progress (the `~` loading state).
- Tests: `node --test` on deterministic tools and output validators.

## Representations

| id | type | contents | file |
|---|---|---|---|
| artworks | `Artwork[]` | id, title, image url, width, height | server/store.js |
| artwork_metadata | `ArtworkMetadata[]` | title, artist, year, medium, objects[{label,bbox}] | server/store.js |
| bounding_boxes | `BoundingBox[]` | unitId, artworkId, x,y,w,h | server/tools/extract.js |
| basic_labels | `BasicLabel[]` | unitId, label (coarse category from metadata) | server/tools/extract.js |
| artwork_descriptions | `{artworkId,text}[]` | model prose per artwork | server/processes/p1.js |
| unit_descriptions | `{unitId,text}[]` | model prose per unit | server/processes/p1.js |
| task | string | annotation task instruction | public/app.js (form) |
| skill_library | `{versions: Skill[][]}` | Skill: id, name, description, whenToUse, procedure, origin | server/store.js |
| knowledge_base | `{versions: KB[]}` | entries[{id,topic,content,source}] | server/store.js |
| label_taxonomy | tree | nodes[{id,label,parent,definition}] | server/seed/taxonomy.js |
| suggested_skills / chosen_skills | `{skillId,reason}[]` / `skillId[]` | selection into library | run record |
| text_embeddings | `number[][]` | hashed TF‑IDF of unit+artwork descriptions | server/tools/embeddings.js |
| image_embeddings | `number[][]` | colour histogram + thumbnail of unit crop | server/tools/embeddings.js |
| clusters (v1,v2,v3) | `{id,name,unitIds}[]` | unit→cluster assignment | run record |
| cluster_patterns | `{clusterId,text}[]` | | run record |
| label_scores | `{clusterId,scores[{labelId,score}]}[]` | 0..1 | run record |
| recommended_labels | `{clusterId,labelId}[]` | taxonomy leaf | run record |
| recommendation_rationales | `{clusterId,text}[]` | | run record |
| cluster_priorities / priority_clusters | `{clusterId,priority,reason}[]` / ordered ids | | run record |
| focused_cluster | clusterId | UI selection | public/app.js |
| annotation_feedback | `{clusterId,unitId,verdict,comment}[]` | | state.feedback |
| confirmed_labels (v1,v2) | `{unitId,labelId,source,runId}[]` | | state.confirmedLabels |
| interaction_logs (v1,v2) | `{id,ts,type,…}[]` | | state.interactionLogs |
| chat_focus / question / chat_answer / chat_decision | selection / text / {answer,suggestedLabelId} / {accepted,labelId,note} | | state.chat |
| mined_behaviors, candidate_skills, matching_skills, skill_differences | records | | state.learning |
| task_summary | text | | state.learning |

## Transformations

| process | actor op | function / component | file |
|---|---|---|---|
| 1 | tool_1 extract | `tool1Extract` | server/tools/extract.js |
| 1 | model_1 generate~ | `model1Describe` | server/processes/p1.js |
| 2/7 | model_2 select | `model2SelectSkills` | server/processes/p2.js |
| 2/7 | human select | skill checklist | public/app.js `renderSkillPicker` |
| 2 | tool_2 translate | `tool2TextEmbed` | server/tools/embeddings.js |
| 2 | tool_3 translate | `tool3ImageEmbed` | server/tools/embeddings.js |
| 2/7 | model_3 assign | `model3Assign` | server/processes/p2.js |
| 2 | model_3 modify | `model3Refine` | server/processes/p2.js |
| 2/7 | model_3 generate~ | `model3Patterns` | server/processes/p2.js |
| 2/7 | model_4 evaluate | `model4ScoreLabels` | server/processes/p2.js |
| 2/7 | model_4 select | `model4RecommendLabels` | server/processes/p2.js |
| 2/7 | model_4 generate~ | `model4Rationales` | server/processes/p2.js |
| 2 | model_4 evaluate | `model4Prioritize` | server/processes/p2.js |
| 2 | model_4 select | `model4SelectPriority` | server/processes/p2.js |
| 3 | human select | priority list | public/app.js `renderReview` |
| 3 | human evaluate | agree/disagree per unit + comment | public/app.js |
| 3 | human assign | label picker + confirm | public/app.js → POST /api/review/confirm |
| 3 | tool_4 extract | `tool4ExtractLogs` | server/tools/logs.js |
| 4 | human select | chat focus picker | public/app.js `renderChat` |
| 4 | human specify | question field | public/app.js |
| 4 | model_5 generate~ | `model5Answer` | server/processes/p4.js |
| 4 | human evaluate | accept / reject answer | public/app.js |
| 4 | human assign | apply suggested label | POST /api/chat/decide |
| 4 | tool_4 expand | `tool4ExpandLogs` | server/tools/logs.js |
| 5 | model_6 extract | `model6MineBehaviors` | server/processes/p5.js |
| 5 | model_7 generate~ | `model7CandidateSkills` | server/processes/p5.js |
| 5 | model_8 match / evaluate / modify~ | `model8Match`, `model8Compare`, `model8UpdateLibrary` | server/processes/p5.js |
| 6 | model_9 extract~ | `model9Summarize` | server/processes/p6.js |
| 6 | model_10 modify | `model10UpdateKB` | server/processes/p6.js |

## Images
The design lists none. Artworks are synthetic scenes generated locally (`npm run seed`); users can upload
their own images with object boxes.

## Open choices (defaults taken)
- Provider: Claude Code CLI, model `sonnet` (env `CLAUDE_MODEL`).
- Triggers: P1 by "Describe collection"; P2/P7 by "Run task" (P7 mode once the library/KB have learned
  versions, selectable); P3/P4 interactively; P5+P6 together by "Learn from this session".
- Layout: tabbed single page — Collection · Task & Clusters · Review (+ chat side panel) · Learning · Library.
