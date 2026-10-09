# NOTES — decisions the design did not determine

The design contained only the seven process expressions. It had no goal, system or process
descriptions, no representation descriptions, no references and no images, and its identifiers are
opaque (`r1`…`r34`). As a result, almost everything below the level of "which step follows which" was my decision.

## Domain and meaning of representations

- **Domain**: I read the structure as an image-labeling assistant. I chose this because of
  images + annotation records, model labels with rationales and scores, a human review queue,
  labeled examples, and later learning of a record library (r8) and a single record (r9).
  The demo task is *pedestrian-risk labeling of street scenes*, which is my own invention.
- r2 = per-image object annotations `{label, bbox:[x,y,w,h]}`. r3 = bounding boxes. r4 = object classes.
- r5 = one-sentence caption, r6 = longer description. These are two language collections from one generate step, and I assumed they differ in detail.
- r7 = labeling instruction. r8 = **guideline library** `{id,name,rule,label}`. r9 = **user profile** `{preferences[], summary}`. r10 = **concept taxonomy** (scene types).
- r11 = model-suggested guidelines with reasons. r12 = the guidelines the human ticks.
- r13/r14 = caption and guideline vectors. Their cosine similarity is shown to model_3 as a hint (top 3 guidelines per image).
- r15 = task label. The label set is every `label` named in the guideline library plus `unclear`, and it is enforced in validation, not only in the prompt.
- r16 = rationale. r17 = how well the rationale supports the label (0–1). r18 = taxonomy leaf concept, restricted to leaves in validation.
- r19 = a short note telling the reviewer what to check. r20 = likelihood the label is wrong. r21 = `review` / `auto` priority.
- r22/r26 = the image selected in the gallery. r23 = `{verdict: agree|disagree, comment}`. r24 = final human label.
- r25 = labeled-example record (label, model label, concept, caption, rationale, verdict, comment, Q&A dialogue).
- r27 = free-text question. r28 = answer + suggested label. r29 = `{helpful, comment}`.
- r30 = distinguishing features per label. r31 = candidate guidelines. r32 = matching existing guideline or null.
  r33 = add/merge/skip with reason. r34 = prose summary of how the person labels.

## Process wiring and triggers (no descriptions given, so all are my choice)

- Every process is started by a button. P1: "Prepare dataset". P2: "Suggest guidelines" then "Run labeling". P3: "Save review". P4: "Ask" then "Confirm".
  P5: "Learn guidelines". P6: "Update profile". P7: "Re-run with edited instruction" (shown once a run exists).
- P2's human select is a pause in the pipeline. The server runs model_2 select, the UI shows checkboxes pre-ticked with the suggestions, and the rest runs when the user confirms. Library guidelines that were not suggested can also be ticked, under "Other guidelines".
- P3's human select, evaluate and assign are combined in one card: verdict buttons, a comment, a label menu pre-filled with the model label, then "Save review". Choosing "Agree" resets the label to the model's label.
- P4's human evaluate and assign: Helpful/Not helpful + feedback + a label menu pre-filled with the suggested label. tool_4 expand appends the Q&A to the example's `dialogue`.
- P5's `model_8 modify~` commits the updated library without a human step, because the design has none. To compensate, new and changed guidelines are marked in the UI, the old rule is shown struck through, and earlier versions can be restored. Validation rejects a library that drops an existing guideline or duplicates ids.
- P7 follows its expression exactly: no embeddings, no refine step, no uncertainty/queue steps. So after a re-run the review queue (r21) is empty, and the gallery's "Review queue" filter shows nothing; reviewers use "All". This is a visible consequence of the design that I left as is.
- Editing the instruction saves a new version (r7_2). Earlier instructions, guideline libraries and profiles can be restored. Task-label versions are kept, and the gallery shows "was X" when refinement changed a label.
- Only one job runs at a time (server lock). The client polls `/api/state` every 1.5 s while a job runs and shows the latest log line.

## Model prompts and calls

- One prompt per model operation (see `server/pipeline.js`). Each asks for JSON only and is validated: images covered exactly, labels and concepts from the allowed sets, scores clamped to [0,1]. On invalid output there is one retry, with the error appended to the prompt.
- model_1 and model_5 see the actual image. The CLI is given `--allowedTools Read` and the absolute PNG paths. model_1 processes images in batches of 4, run in parallel.
- Other steps are batched: one call per step over all images, not one call per image. This keeps latency acceptable: a full P2 run on 8 images is 8 sequential CLI calls and takes a few minutes. I did not time it precisely.
- Model roles (model_1…model_10) get different system prompts via `--append-system-prompt`. Steps with the same instance number share a system prompt.
- model_4 select (queue) forces at least one `review` item, picking the highest uncertainty, so the human step always has input.

## Libraries, data formats, persistence

- Node 20 + Express, vanilla ES-module front end with no build step, `sharp` (renders demo SVG scenes to PNG and normalises uploads to PNG), `multer` (uploads), `node:test`.
- Embeddings: hashed bag-of-words with 256 dimensions and L2 normalisation. This is deterministic, matching "tool translate", and needs no model download.
- Persistence: a single `data/state.json`. Uploading or loading the demo replaces the dataset and resets everything.
- Upload format: images plus an optional JSON `[{file|imageId, objects:[{label,bbox}]}]`.
- Demo: 8 synthetic street scenes, 6 seed guidelines, a one-preference profile and a 3-level taxonomy.

## Layout and styling

- Three columns. Left is Task: dataset, instruction, guideline checklist, library, profile, taxonomy with counts per concept, and the learning panel. Centre is the Gallery: cards with bounding-box overlay, caption, label chips, support/uncertainty bars, queue badge and human label, plus filters for All / Review queue / Labeled. The All and queue views are sorted by uncertainty. Right is the Inspector: large image, description, rationale, note, review form and ask box.
- Neutral light theme, colour-coded label chips (red/amber/green/grey), and a job status in the header and a log footer.

## Verification

- `npm test` (5 tests) and `npm run check` pass.
- I walked through all seven processes against the live CLI through the HTTP API. Every transformation was reached and produced validated output. A stubbed-DOM render of the UI over the resulting state produced no `undefined`/`NaN`. I did not exercise the UI in a real browser.

## Did the design remind me of a published system?

Not of one specific system I could name with confidence. The identifiers were opaque and nothing in the
design named a domain. The overall shape (models label data, models check the labels, a human reviews
an uncertainty-ranked queue, and corrections are turned into a reusable "rule/guideline library" and a "user
profile" that improve later runs) resembles a general family of work I know: interactive/LLM-assisted
data-labeling tools that learn labeling rules or guidelines from human feedback, and
personalised-assistant systems with memory. Choices that came from that general background rather than from the design:

- interpreting r8 as a **guideline/rule library** and r9 as a **user preference profile**;
- interpreting r21 as an uncertainty-based **review queue** (active-learning style prioritisation);
- process 5 as **add / merge / skip** curation of induced rules against the existing library;
- the **street-scene pedestrian-risk** demo, and taxonomy r10 as scene types (my own example, not taken from any paper).
