# NOTES — decisions the design did not determine

The design gives only the seven expressions. It has no name beyond "System X", and its goal, description, process
descriptions, representation descriptions, references and images are all empty. Every item below is my own choice.

## Domain and data
- **Domain**: The design never says what "units" are. I took them to be regions inside artworks (figures, animals,
  buildings…), each given by a bounding box in the artwork metadata. Annotation means giving each unit an
  iconographic label.
- **Sample collection**: The design has no data and I worked offline, so `server/seed/artgen.js` draws 12 simple
  "naive paintings" (Annunciation, harbour, rider, saint…) as SVG with seeded randomness, and sharp renders them to PNG.
  Each drawn object writes its own box and a coarse basic label (person, animal, plant, landform, celestial, building,
  boat). In total there are 67 units. You can also upload your own images with box JSON.
- **artwork_metadata format**: `{title, artist, year, medium, objects:[{label, bbox:[x,y,w,h]}]}` in pixels from the
  top-left corner.
- **label_taxonomy**: a two-level iconographic tree with 28 nodes (figure poses, animals, nature, architecture, vessels,
  symbolic markers such as halo and cross). It is read-only in the UI. The design has no step that edits it.
- **skill_library_1**: five seed skills, each `{id, name, description, whenToUse, procedure, origin}`.
- **knowledge_base_1**: three seed conventions, each `{id, topic, content, source}`.
- **Unit ids**: `<artworkId>-u<n>`, which stay the same when descriptions are regenerated.

## Model steps (all via `callModel` in `server/llm.js`)
- **Provider**: Claude Code CLI with `--json-schema` structured output and `--system-prompt` per role. Image steps use
  `--tools Read`; the others use `--tools ""`. Default model `sonnet`, up to 4 calls at once, and one automatic retry
  that gives the model the validation error.
- **One prompt per operation**. Each prompt is built only from the representations in the preceding state, with these
  interpretations:
  - **task_1 after skill selection**: the design drops task_1 once the human has selected skills, so model_3 never sees
    the task. To carry the task forward without breaking that, model_2's `suggested_skills` record includes an
    `application` field. It is a task-specific note on how to apply each skill, and it travels with chosen_skills.
  - **Embeddings in model_3 assign**: model_3 receives the embeddings (tool_2/tool_3) as k-means "similarity hint
    groups". Raw vectors would mean nothing in a prompt. k-means runs in code on the joined vectors, with
    k ≈ √(n/2).
  - **artworks_1 for model_4 and model_5**: these steps see artworks_1 as a contact-sheet PNG of unit crops, one row
    per cluster, built with sharp. model_1 sees each full artwork image along with its box coordinates.
  - **Interaction logs in chat**: model_5's prompt includes the last 15 log records.
- **Embeddings**: tool_2 hashes TF-IDF of the unit description into 256 dimensions, adding the artwork description at
  weight 0.2. tool_3 combines a 64-bin RGB histogram, a 4×4 grey thumbnail and the aspect ratio of the crop (81
  dimensions). Both are deterministic, so no embedding model is needed.
- **Output validation (constraint enforcement in code)**:
  - Every unit ends up in exactly one cluster; missing units go to an "Unassigned" cluster.
  - Label ids must exist in the taxonomy, and the recommended label must be one of the scored candidates for that cluster.
  - Scores and priorities are clamped to 0..1.
  - Skill ids in suggestions must exist in the library.
  - Library updates need unique ids and may drop at most half of the existing skills.
  - KB edits arrive as add/update/remove operations, which code applies.
- **model_3 assign** is an LLM call. The design runs it in process 7 without embeddings, so it cannot be pure k-means.
- **Priority**: "review urgency" from 0 to 1, weighing uncertainty, cluster size and the risk of a wrong reading. The
  model_4 priority select step returns an ordered review queue.
- **model_10 modify** is not marked generative, so it returns structured edit operations rather than free text.
- The prompt wording for each role is my own and is in the process files.

## Triggers, flow and persistence
- **Process 1**: the *Describe collection* button. It describes only artworks that have no description yet, and a
  *Regenerate* button forces all of them.
- **Processes 2 and 7**: one task form with a mode toggle. Process 7 is the default once a learned version of the library
  or KB exists. Process 7 skips embeddings, refinement and prioritisation, as the design specifies.
- **Process 2 human select**: model_2's suggestions with relevance ≥ 0.5 are pre-checked. Other library skills can be
  added. Skills that the curator adds get a generic application note.
- **Process 3**: the queue is ordered by priority_clusters, and the remaining clusters sit under "Other clusters".
  - Each unit defaults to *agree*.
  - *disagree* can carry a replacement label and a comment; *unsure* leaves the unit unlabelled.
  - One label applies to all agreeing units.
  - After confirming, the view moves on to the next unreviewed cluster.
- **Process 3 on process 7 runs**: review is also enabled for these runs, which have no priority queue, so their clusters
  are listed in order. The design's connections only say process 3 continues from process 7 "through artworks_1". This
  is my reading of the loop, not a stated step.
- **Process 4**: the chat focus is a cluster or a single unit, set from a dropdown or the *ask* buttons.
  - model_5 may propose one label for some focused units.
  - The curator can accept it (optionally changing the label), reject it, or mark a no-label answer as helpful.
  - Only accepted labels change confirmed_labels.
- **Processes 5 and 6**: one *Learn skills & update knowledge* button runs both in parallel on the logs that are new
  since the last round. The design gives no trigger. I picked an explicit, end-of-session action.
- **Versions**: every version of the skill library and the knowledge base is kept, can be browsed, and is shown as a
  diff in each learning round. Each run records which versions it used. confirmed_labels and interaction_logs are
  single growing lists with a version counter.
- **Persistence**: `data/state.json` plus image files. There is a single user and a single project.
- **Long model chains**: these run as background jobs that the UI polls every 1.2 s. Each grammar step appears as a
  chip with pending/running/done/error status. This is how the `~` loading states are handled.

## Stack, layout, styling
- **Stack**: Node 20 + Express (ESM, plain JS), sharp, multer. The frontend is vanilla JS with no build step. Tests use
  `node --test`.
- **Layout**: five tabs (Collection · Task & clusters · Review & chat · Learning · Library).
  - The review tab has three columns: queue | focused cluster with unit cards | chat.
  - Unit thumbnails are CSS crops of the artwork image.
  - Scores and priorities are drawn as bars, not numbers alone.
- **Styling**: warm "museum" palette (dark brown header, cream background), system font.
- **Port**: 4317, because 5173 was already in use on this machine.

## Did the design remind me of a published system?
Partly. Clustering units, recommending labels per cluster, prioritising the review and learning from logs looks like
recent "LLM-assisted qualitative coding / data annotation" tools. The mining of interaction logs into a reusable,
versioned **skill library** looks like agent skill-library work in the Voyager style and like "self-evolving agent"
papers. The artwork, bounding-box and unit-description setting made me think of computational art-history annotation
tools, for example systems for iconographic annotation of paintings or comics panels. I cannot name one specific
published system that this design reproduces, and I did not look anything up.

Choices that came from that general background knowledge rather than from the design:
- reading "units" as iconographic regions and building an iconographic taxonomy with poses such as orant and halo
- making skills natural-language procedures with "when to use", which follows the Voyager / agent-skill convention
- classifying candidate-vs-existing skills as new / refines / duplicate / conflicts
- pre-clustering with embeddings and k-means before LLM clustering, a common pattern in LLM-assisted topic and
  annotation tools
- treating priority as review urgency, an active-learning style "review the uncertain clusters first"
