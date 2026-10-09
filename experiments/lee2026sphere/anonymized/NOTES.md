# NOTES — decisions the design did not determine

`design.json` gives three process expressions and how they connect. It has **no** goal, system description, process descriptions, representation descriptions, references or images, and all identifiers are opaque (`r1` … `r31`). The design fixes only the roles, media, actors, operations, the order of steps, and which representations are present together. Everything below was my choice.

## 1. Domain (the biggest decision)

| Design fact | My interpretation |
|---|---|
| r1 instruction language + r2, r3 artifact records at the start; r2 → r2_2 and r3 → r3_2 at the end of process 3 | r1 = a scene request; r2 = an **asset library** (it grows); r3 = a **learned model** of the library (it is "trained"), implemented as per-asset reliability weights |
| `[model_3 translate]` → r4 artifact numeric, then `[tool_3 match]` → r5 selection* | the request is embedded, and nearest-neighbour retrieval picks candidate assets |
| `[model_4 match]` → r6 tabular, `[tool_3 select]`, `[model_5 match]` → r8 tabular (r3 consumed here), `[tool_3 select]` | rerank table, then a shortlist; slot-assignment table (which asset fills which role); final choice weighted by reliability r3 |
| `[tool_1 generate]` ×2, r13 artifact graph, `[tool_2 translate]` → r14 artifact spatial | a deterministic layout solver builds a scene graph; a scene engine turns it into placed objects (positions) |
| Process 2: `[human select]` → selection spatial, `[human specify]` → instruction **audio**, `[model_1 translate]` → language, then `[model_2 translate]~` / `[model_2 decompose]~` / `[tool_2 execute]` back to r14 | point at objects and speak ("move this…"); speech-to-text; a model interprets the command and splits it into atomic edit ops; the engine applies them |
| Process 3: snapshot → table → relation graph → subgraphs → `[model_6 expand]~` → `[model_6 extract]~` language* → records* → r2_2 → visual → `[model_7 evaluate]` categorical* → `[tool_5 evaluate]` numeric* → `[tool_5 train]` r3_2 | **library learning**: mine groups of adjacent objects, have a model name and describe them as composite assets, add them to the library, render them, have a model judge them (accept/revise/reject), turn verdicts into scores, and update reliability |

The "spatial" artifact is a **2D top-down floor plan** in centimetres, not 3D, VR or AR. The design only says "spatial", and 2D keeps direct selection simple.

## 2. Representation contents and data formats

All types are in `shared/types.ts`.

- **r4** is a 16-dimensional vector over fixed, readable axes (seating, sleeping, storage, … reading). No embedding API was available, and Claude cannot return real embeddings, so model_3 rates each axis from 0 to 1. Library assets get vectors over the same axes from a deterministic keyword lexicon (`LEXICON` in `server/library.ts`).
- **r5** is the top 18 by cosine similarity, **plus the 2 best assets on every axis the request weights ≥ 0.4**. I added the second rule after a live run dropped an explicitly requested plant. Composite candidates carry their member ids.
- **r6** has rows `{assetId, relevance 0–10, reason}`. **r7** keeps relevance ≥ 5, or the top 5 if none pass.
- **r8** has rows `{slot, assetId, count 1–8, confidence 0–1}`. **r9** takes the best asset per slot by `confidence × (0.5 + 0.5·reliability)`. The same asset across slots is merged. **Members of a chosen composite are removed from the rest of the selection**, because model_5 ignored this instruction in the prompt during testing, so it is enforced in code.
- **r10** is a list of instances with footprints. **r11** is `{id, title, request, room {width, depth}, createdAt}`. Room size is derived from total furniture area (×3.2, aspect 1.25, minimum 400×320 cm).
- **r12** is the room, the instances, and spatial hints. Hints come from regexes over r1 ("X next to/near/beside Y", "in the corner", "in the middle", "against the wall") plus a hand-written affinity table (chairs → tables, lamps → seating, nightstand → bed, …).
- **r13** is a graph: a room node, object nodes carrying solved positions, and edges `contains`, `near`, `against-wall:<side>`, `in-corner`, `centered`. The solver is greedy: centre items first, then walls, corners, and items that depend on others. It uses axis-aligned collision checks, and rugs and play mats are allowed under other furniture.
- **r14** objects have the form `{id, assetId, name, x, y (centre), w, h, rot (deg clockwise), color, shape}`. At rot 0 an object's front faces south. This convention is written into the model_2 and model_6 prompts.
- **r15** is view state `{scale, showGrid, editLog}`. The design keeps r15_1 unchanged through process 2. I append each command to the edit log anyway, so the user sees a history; this is a small departure from the design.
- **r16** is `{objectIds, region?}`. **r17** is a WebM blob from MediaRecorder, playable in the UI. **r18** is a string the user can edit.
- **r19** is `{utterance, selection {ids, objects, region}, room, objects}`. **r20** is `{action, targets, parameters, explanation}`. **r21** is an op from the set move, moveTo, rotate, scale, recolor, delete, duplicate. There is no "add from library" op, because r2 is not in process 2's state.
- **r24** links two objects when the gap between their footprints is ≤ 45 cm; floor coverings are ignored. **r25** keeps connected components of 2 to 8 objects as `group_n`.
- **r26** adds a name, a function, a coherence flag and semantic relation edges to each group. **r27** is one line per arrangement: "Name — description".
- **r28** is a composite asset. Members are stored relative to the group's centre and rotated so the side nearest a wall becomes north, which matches how wall items are placed. Its vector is the maximum of the lexicon vector and 0.8 × the member vectors.
- **r2_2** is the library plus new composites. Duplicates (same member multiset) are skipped, and the version only increases when something is added.
- **r29** is an SVG thumbnail per new asset. model_7 receives the SVG markup as text, since the CLI path is text-only.
- **r30** is accept, revise or reject with a reason. **r31** maps verdicts to 1, 0.5 and 0, applied to the composite and averaged over its member assets.
- **r3_2** is an exponential moving average: `w ← w + 0.3·(score − w)`, with prior 0.6 and per-scene history kept.

## 3. Model calls and prompts

- There is one provider function, `callModel()` in `server/llm.ts`. It runs `claude -p --output-format json --model $CLAUDE_MODEL --system-prompt … --tools ""` with `CLAUDECODE` removed from the environment and a temporary working directory, and reads the `result` field. The default model is `sonnet`, chosen for speed.
- `callModelJson()` extracts the first JSON value, validates it with a hand-written validator, and retries once with the validation error appended.
- There is one prompt per operation. model_2 uses **one shared system prompt** (one role and configuration) with two different user prompts, for translate and decompose. model_6 likewise does two operations with separate prompts. All prompts are in `server/process1.ts`, `process2.ts` and `process3.ts`.
- Validation enforces each representation where it is produced: vector length and range, ids must exist among the candidates or layout, counts are clamped, colours must be hex, ops must come from the allowed set, verdicts must come from the fixed set, and every new asset must get a verdict.
- **model_1 (speech → text) is the browser's Web Speech API, not Claude**, because the Claude CLI cannot take audio. This departs from the instruction to run every model step through the CLI. There is a typed fallback when speech recognition is unavailable.
- `MOCK_MODEL=1` swaps in deterministic stubs, used only by tests.

## 4. Triggers and interaction

- The design has no process descriptions, so these triggers are my choices.
  - Process 1 runs on the "Compose scene" button (or Cmd/Ctrl+Enter).
  - Process 2 runs when you release the hold-to-talk button (auto-submits if speech recognition produced text) or press "Apply" on the typed or corrected transcript. It loops indefinitely.
  - Process 3 runs on "Learn from this scene" and can be used with or without process 2 edits.
- Selection works by click, shift-click or cmd-click to add, or by dragging a rectangle; the region is kept as part of r16. Clicking empty floor clears the selection.
- Undo keeps the last 30 layouts. The design has no undo; I added it as the "keep earlier versions" affordance for the loop.
- Generative steps stream progress as NDJSON (`start` and `step` events per transformation). The UI shows a live pipeline trace with a spinner per running step, and errors appear in a dismissible banner. There is no human review before process 2 ops are applied, because the design has none; Undo covers that.
- Process 3 results appear as verdict badges and highlighted library cards.
- "reset library" restores the seed library and reliability model. This is a utility, not a design step.

## 5. Layout and styling

- The page has three columns: request and examples with the pipeline trace (left), the floor plan with voice bar, edit log and Learn button (centre), and the library with learned arrangement cards, reliability bars and base assets (right).
- Header pills show which process is running.
- The palette is warm neutral, with blue for primary actions, orange for selection, and green, amber and red for verdicts. Objects are coloured shapes with labels and a dark line marking the front edge.
- Each step's output in the trace is rendered by medium: numeric → bars, tabular or collections → table, graph → outline plus edge list, visual → thumbnails, categorical → badges, record → JSON.

## 6. Libraries and stack

- Node 20 and TypeScript; Express 5 backend run with `tsx`; React 19 + Vite frontend; plain CSS; SVG rendering; `node:test` for tests.
- No database: JSON files in `data/`. The current scene is kept in browser `localStorage`.
- The seed library has 44 hand-written assets (name, footprint in cm, colour, placement class, tags).

## 7. Did the design remind me of a specific published system?

Not of any single system I can name with confidence. The design is anonymised, and I did not look anything up. Parts of it resembled published work I know, and those resemblances shaped some choices:

- **Process 1** resembles LLM-driven 3D scene generation with asset retrieval, especially **Holodeck** (Yang et al., CVPR 2024). It retrieves Objaverse assets by embedding similarity, has an LLM check and select them, generates spatial constraints, and runs a layout solver. From this I took: reading r2 as an *asset library*, r4 as an *embedding* for retrieval, the model steps as *rerank and select*, and the tool steps as a *constraint and layout solver* producing a scene graph. The design itself only says "numeric", "match", "generate" and "spatial".
- **Process 2** (select a spatial region, then speak) is the classic "point + speak" multimodal pattern of **Put-That-There** (Bolt, 1980) and later LLM-era voice-plus-pointing editors for VR or mixed reality. From this I took: resolving "this/these/here" to the selection, and the push-to-talk microphone.
- **Process 3** reminded me of **library learning** in program synthesis, e.g. **DreamCoder** and **LILO** (which uses an LLM to auto-document learned abstractions). The chain is: compress recurring structure into new library entries, have a model name and describe them, then evaluate. From this I took: reading r22–r28 as "mine reusable composite assets and document them", and reading tool_5 train as updating a model of how good library entries are.
- The **3D/VR context** some of these systems use was *not* adopted. I chose a 2D floor plan for feasibility.
- These choices came from that prior knowledge, not from the design: the asset and furniture domain itself, the "composite asset" idea, and treating r3 as per-asset reliability. Everything else follows from the grammar's roles, media and operations.
