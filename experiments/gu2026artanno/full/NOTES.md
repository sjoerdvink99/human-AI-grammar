# NOTES — decisions the design did not determine

## Stack and libraries
- Node 20 + Express, vanilla ES-module frontend with no build step. Libraries: `express`, `multer` (uploads), `sharp` (image features and sample rendering), `zod` (validating model output). Tests use `node --test`.
- Persistence is a single JSON file (`data/state.json`) plus an image folder. Earlier skill-library and knowledge-base versions are kept in `history` arrays. Confirmed labels keep only their latest value; the earlier values are in the interaction log (`labelsBefore`/`labelsAfter`).

## Model provider
- Every model step goes through `callModel()` (server/llm.js), which runs `claude -p --output-format json --model sonnet` with `CLAUDECODE` removed. The prompt goes in on stdin. Text-only calls run with `--tools ""`. Calls that need images get `--tools Read --allowedTools Read --add-dir <image dir>` and the image paths.
- `callModelJson()` extracts the first JSON value, checks it against a zod schema plus a semantic check (ids exist, partition is valid, labels come from the taxonomy, every cluster is covered), and retries once with the error fed back.
- Each model actor (model_1…model_10) has its own system prompt naming the agent from the design ("Skill Recommendation Agent", "Cluster and Pattern Mining Agent", "Label Recommendation Agent", "Chatbot Agent", "Behavior Mining Agent", "Skill Generation Agent", "Skill Management Agent", "Summary Agent", "Memory Management Agent"). model_1 is an "art historian" describer. All of the prompt wording is mine.

## Tool substitutions (no API key or local models available)
- **tool_1 (object detection model):** there is no local detector, so detection is a vision call through the same provider. It is limited to a fixed set of 30 basic classes (`BASIC_LABELS`); anything else becomes `other`. Boxes are normalised and clamped. It still counts as a tool step in the code and UI, but it is really an LLM.
- **tool_2 (text similarity embeddings):** deterministic TF-IDF over each region's basic label + description + its artwork's description.
- **tool_3 (image similarity embeddings):** a 64-bin colour histogram plus an 8×8 grayscale layout of each region crop, computed with sharp.
- Embeddings reach model_3 as a top-3 nearest-neighbour list per region (text and image cosine), not as raw vectors.
- **tool_4:** an "actor" the design does not declare. It is deterministic log writing (`extract` creates review records, `expand` appends chat records).

## Data formats
- **Units:** the detected regions, `art-N.uK`, each with a normalised box `{x,y,w,h}`, a basic label and a description. Clusters group regions (not whole artworks), possibly across artworks.
- **Clusters:** `{id, name, unitIds}`. model_3 assign returns ids `c*`; after model_3 modify they become `k*`. clusters_1 is kept as `clustersInitial`. Regions may be left unclustered.
- **Labels:** recommended, confirmed and suggested labels must be leaves of the label taxonomy. This is enforced in validation and in the API, not just stated in prompts. Recommended labels must also be among that cluster's scored labels.
- **Default taxonomy (seed, editable as JSON):** 5 groups and 17 leaves of East-Asian auspicious, moral, relational, seasonal and spiritual meanings.
- **Seed skill library:** 5 skills. **Seed knowledge base:** 2 entries. Skill record: `{id, name, applies_to, procedure[], cues[], version, parent, origin}`.
- **annotation_feedback:** `[{label, verdict: accept|unsure|reject, comment}]`. **chat_decision:** `{verdict: agree|unsure|disagree, note, labels[]}`. **chat_answer:** `{answer, comparisons[{item, contrast}], suggested_labels[]}`.
- **Confirmed labels** are keyed `cluster:<id>` (process 3) or `artwork:<id>` / `cluster:<id>` (process 4).
- **model_8 modify:** the model writes the skill text, and code applies add/merge (version+1)/branch (new id with `parent`)/skip. **model_10 modify:** the model returns `add`/`update` operations, and code applies them, de-duplicating by concept.
- **suggested_skills:** exactly 3 (or fewer if the library is smaller), validated.

## Literal readings of the grammar (worth knowing)
- Model prompts are built only from the representations in the preceding state. As a result, **the task text is not given to model_3 or model_4**: the design drops `task_1` after the human picks skills, so clustering is task-specific only through the chosen skills, the knowledge base and the taxonomy. In testing, a second task about "family and marriage" got much the same clusters as the first. This is a real consequence of the design. Adding `task` to the later states would fix it.
- `artworks_1` (images) is in model_3/model_4 states, but images are not re-sent to those calls, for speed. They are represented through descriptions and image embeddings. Images *are* sent to tool_1, model_1 and model_5 (up to 4 artworks for a cluster focus).
- **Process 7** runs exactly the reduced pipeline: no embeddings, no cluster refinement, no priorities. Its clusters are therefore shown unranked, and process 3 review works on all of them.
- **Which pipeline a task uses:** a task is a "reuse" task (process 7) once the skill library or knowledge base has been updated by a learning run (version > 1). Otherwise it uses process 2.

## Triggers and interaction details
- Process 1 runs on a **Prepare** button, three artworks at a time, with per-artwork Prepare/Re-prepare in the artwork modal.
- Process 2 starts when the user submits a task, which runs model_2 straight away. The human picks skills with checkboxes and clicks analyse, and the rest runs as a background job. The UI polls `/api/state` every 1.5 s while anything is running and shows each grammar step with its status and duration.
- **Regeneration:** "Re-run analysis with these skills", "Retry", ↻ on chat answers, and "Learn again".
- Process 3: clicking a cluster card opens a review panel. Accepting a label adds it to the confirmed chips and rejecting removes it. Corrections come from a taxonomy dropdown, then **Confirm labels**. The time the cluster was open (dwell) is logged.
- Process 4: the focus is chosen from a dropdown, an "Ask chatbot about this cluster" button, or the artwork modal. Then come the question, the answer with comparisons and suggested labels, an agree/unsure/disagree verdict, label editing, an optional note, and **Save decision**.
- Processes 5 and 6 start from a **Finish task & learn** button once at least one interaction is logged, and run in parallel. The design says "after annotation interactions are recorded", and I chose an explicit button rather than running them after every log entry, because of cost.

## Layout and styling
- Three columns. **Left:** tabs for Artworks / Skills vN / Knowledge vN / Labels. **Centre:** task input, step progress, suggested skills, a cluster card grid (priority clusters first, with a left accent bar and a #rank), the review panel and the learning panel. **Right:** the chatbot.
- The artwork modal shows the image with bounding-box overlays (hovering a region highlights its box), metadata, descriptions and cluster membership.
- Region thumbnails are CSS background crops of the original image.
- Warm paper-like palette, an ink-red accent and a blue selection colour, using the system font.

## Sample data
- 8 procedurally drawn SVG "paintings" rendered to PNG with conventional motifs: pine & crane, peonies in a vase, carp & waves, five bats among clouds, plum blossoms in snow, mandarin ducks, bamboo & rock, peaches & bats. Each has invented catalogue metadata ("… (style)"). Users can upload their own images and metadata.

## Verification
- `npm test` passes offline: all seven processes run with a mocked model, plus the validation checks.
- A live run through the Claude CLI completed every process: preparing all 8 artworks; process 2 (11 steps, about 65 s, 10 clusters, 5 put forward); process 3 review via API and UI; a process 4 chat and decision; processes 5 and 6 (library v2: +3 skills, 1 merge; knowledge v2: +5 entries); and a process 7 task on the new versions. The UI loaded in headless Chromium with no console errors (screenshots in `docs/`).

## Did the design remind me of a published system?
The design suggests an agentic system for annotating cultural symbolism in artworks that builds a skill library from the annotator's work. Its parts include task-specific clustering, skill recommendation, label recommendation with rationales, a chatbot, behaviour mining → skill generation → skill management, and summary + memory agents. **I do not recognise a specific published system** that matches it, so I cannot name one. The general ideas are familiar from other work: a skill library that grows from experience (as in Voyager-style LLM agents), memory-management agents, and LLM-assisted qualitative coding and clustering tools. None of my choices came from a particular paper.

Two choices came from general domain knowledge, not from the design:
- the **Chinese/Japanese auspicious-motif focus** of the sample data, taxonomy and seed skills (homophone puns, motif pairings). The design only says "culturally implicit meanings in artworks".
- **merge / branch / add / skip** as the outcomes of skill management. The design names merge and branch, and I added add and skip.
