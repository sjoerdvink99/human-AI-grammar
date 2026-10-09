# PLAN — System X

The design (`design.json`) contains only expressions: no goal, no description, no
representation descriptions, no references, no images. Identifiers are opaque (`r1`…`r34`).
Following the skill, I inferred contents from the structure and took my own default for every
open choice (recorded here and in NOTES.md) instead of waiting for confirmation.

## Inferred domain

An **image labeling assistant that learns guidelines and user preferences**:
images with object annotations are prepared (boxes, object classes, captions, descriptions);
a labeling task (instruction) is run against a library of labeling guidelines, a user profile and
a concept taxonomy; models assign labels, write rationales, score them, pick a taxonomy concept
and write reviewer notes, and prioritise a review queue; a human reviews and labels items, can ask
the assistant about an item, and the labeled examples are used to learn new guidelines (library
update) and to update the user profile; the task can then be re-run with an edited instruction.

## Representations

| id | type | contents (inferred) | state key / file |
| --- | --- | --- | --- |
| r1 | artifact visual * | images in the dataset | `images` — server/store.js |
| r2 | artifact record * | per-image annotation record `{imageId, objects:[{label,bbox}]}` | `annotations` |
| r3 | selection spatial * | object regions (bboxes) | `regions` |
| r4 | label categorical * | object class of each region | `objectLabels` |
| r5 | artifact language * | short caption per image | `captions` |
| r6 | artifact language * | detailed description per image | `descriptions` |
| r7 | instruction language | labeling task instruction (versioned) | `instruction` |
| r8 | artifact record * | guideline library `{id,name,rule,label}` (versioned) | `guidelines` |
| r9 | artifact record | user profile `{preferences[],summary}` (versioned) | `profile` |
| r10 | artifact graph | concept taxonomy (tree of nodes) | `taxonomy` |
| r11 | selection record * | model-suggested guidelines `{guidelineId,reason}` | `suggestedGuidelines` |
| r12 | selection record * | guidelines the human activated | `activeGuidelines` |
| r13 | artifact numeric * | caption vectors | `captionVectors` |
| r14 | artifact numeric * | guideline vectors | `guidelineVectors` |
| r15 | label categorical * | task label per image (v1 assigned, v2 refined, v3 re-run) | `taskLabels` |
| r16 | artifact language * | rationale per image | `rationales` |
| r17 | evaluation numeric * | rationale quality / confidence score | `rationaleScores` |
| r18 | label categorical * | taxonomy concept per image | `conceptLabels` |
| r19 | artifact language * | note to reviewer per image | `reviewNotes` |
| r20 | evaluation numeric * | uncertainty score per image | `noteScores` |
| r21 | selection categorical * | review priority per image (`review`/`auto`) | `reviewQueue` |
| r22 | selection categorical | item picked for review | `currentItem` (client) |
| r23 | evaluation record * | human review `{verdict,comment}` | `humanReviews` |
| r24 | label categorical * | final human label per image | `finalLabels` |
| r25 | artifact record * | labeled examples | `labeledExamples` |
| r26 | selection categorical | item selected to ask about | `focusItem` (client) |
| r27 | instruction language | user question | `query` (client) |
| r28 | artifact language | assistant reply | `assistantReply` |
| r29 | evaluation record | human judgment of reply | `replyReview` |
| r30 | artifact record * | patterns per label extracted from examples | `patterns` |
| r31 | artifact record * | candidate guidelines | `candidateRules` |
| r32 | selection record * | matching existing guideline per candidate | `ruleMatches` |
| r33 | evaluation record * | add/merge/skip assessments | `ruleAssessments` |
| r34 | artifact language | preference summary | `preferenceSummary` |

## Transformations

| process | step | function | file |
| --- | --- | --- | --- |
| P1 prepare | tool_1 extract | `tool1Extract` | server/tools.js |
| | model_1 generate~ | `model1Describe` (vision via Read tool) | server/pipeline.js |
| P2 label run | model_2 select | `model2SelectGuidelines` | server/pipeline.js |
| | human select | guideline checkboxes | public/app.js |
| | tool_2 translate | `tool2EmbedCaptions` | server/tools.js |
| | tool_3 translate | `tool3EmbedGuidelines` | server/tools.js |
| | model_3 assign | `model3Assign` | server/pipeline.js |
| | model_3 modify | `model3Refine` | server/pipeline.js |
| | model_3 generate~ | `model3Rationales` | server/pipeline.js |
| | model_4 evaluate | `model4ScoreRationales` | server/pipeline.js |
| | model_4 select | `model4SelectConcepts` | server/pipeline.js |
| | model_4 generate~ | `model4ReviewNotes` | server/pipeline.js |
| | model_4 evaluate | `model4ScoreNotes` | server/pipeline.js |
| | model_4 select | `model4SelectQueue` | server/pipeline.js |
| P3 review | human select / evaluate / assign | inspector review form | public/app.js |
| | tool_4 extract | `tool4Extract` | server/tools.js |
| P4 ask | human select / specify | inspector "Ask" box | public/app.js |
| | model_5 generate~ | `model5Answer` | server/pipeline.js |
| | human evaluate / assign | reply review + label menu | public/app.js |
| | tool_4 expand | `tool4Expand` | server/tools.js |
| P5 learn guidelines | model_6 extract, model_7 generate~, model_8 match, model_8 evaluate, model_8 modify~ | `process5` | server/pipeline.js |
| P6 update profile | model_9 extract~, model_10 modify | `process6` | server/pipeline.js |
| P7 re-run | model_2 select, human select, model_3 assign, model_3 generate~, model_4 evaluate, model_4 select, model_4 generate~ | `process7*` | server/pipeline.js |

## Open choices (defaults taken)

- Stack: Node 20 + Express backend, vanilla JS single page (no build step); `sharp` to render demo images; `multer` for uploads.
- Model provider: Claude Code CLI (`claude -p --output-format json`, `CLAUDECODE` removed) behind `callModel()` in `server/llm.js`.
- Persistence: one JSON file `data/state.json`, with version history for r7, r8, r9, r15.
- Embeddings (tool_2/tool_3): deterministic hashed bag-of-words vectors (no external model; tools are deterministic code).
- Demo dataset: 8 synthetic street scenes with annotation JSON, a seed guideline library, profile and taxonomy.
- Layout: three columns — Task (instruction, guidelines, profile, taxonomy) | Gallery | Inspector (review + ask).
- Triggers (design gives none): buttons per process; P1 runs on "Prepare dataset", P5/P6 on buttons in the Learn panel, P7 on "Re-run with edited instruction".
