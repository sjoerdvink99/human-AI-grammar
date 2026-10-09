# NOTES — decisions the design did not determine

`design.json` ("System X") has six processes and nothing else: the goal, the system
description, the process names and descriptions, the representation descriptions, the
references and the images are all empty. Identifiers are opaque (`r1` … `r24`). So the
design fixes only which kinds of things exist (role and medium), which actor does which
operation, what is present together at each step, versions, loops and how processes
connect. **Every decision below about meaning was my own.**

## 1. What the system is (the biggest decision)

| Design element | What I decided it is | Why |
| --- | --- | --- |
| r1 artifact language (in every process but 5/6) | a **story** the user pastes | the long-lived source text that everything is derived from |
| r2 artifact spatial* | built-in **map templates** (6 tile maps) | a model *selects* one spatial item from a collection that exists before any model step |
| r3 artifact record* | **characters** | records extracted from the text, then refined by a human in process 2 |
| r4 artifact spatial | the **chosen map** | the result of selecting from r2* |
| r5 label language* | **place names** for the map's regions | language labels a model assigns and a human edits |
| r6 artifact record* | **objects/props** | generated records that a tool then places spatially |
| r7 artifact spatial | **placement** of characters and objects on the grid | tool_1 execute output, then modified by a human (drag) |
| r8/r9/r10*/r11 | character request → persona text → trait label options → chosen trait | process 2 refines r3 |
| r12 record* / r13 record* | story **events** → game **scripts** (trigger → effects) | extract, then compose, from the world + story |
| r14 record | compiled **game spec** | tool_2 composes everything into one record |
| r15 record + r16 visual | **game state** + **rendered view** | tool_2 executes r14 |
| r17 record* / r18 instruction record / r19 record | **suggested actions** / player **action** / matched **rule** | a loop of suggest → act → select → execute |
| r20 visual | end-of-game **storybook** image | the final execute leaves only a visual |
| r21/r22 (process 5) | player **utterance** → character **reply** | only the visual changes (r16_2), the state r15 does not, so it is talk, not action |
| r23 evaluation categorical / r24 language (process 6) | engine **verdict** (`matched`/`unscripted`/`invalid`) → model-**improvised narration** | again only the visual changes, so the narration must not alter the game state |
| tool_1 | deterministic placement algorithm | |
| tool_2 | the deterministic game engine (compose, execute, select, evaluate, render) | the same tool appears in processes 3–6 |

How processes connect: they are tabs of one app (World → Characters → Scripts → Play).
Processes 4, 5 and 6 share the Play screen. Each action is first evaluated (process 6's
`tool_2 evaluate`). `matched` continues process 4 (select + execute). `unscripted` or
`invalid` runs process 6 (the model narrates, and the state stays the same).

## 2. Stack and libraries

- Node 20 + Express 4 (the only runtime dependency). Vanilla JS ES modules and HTML
  canvas, with no framework and no build step. I chose this to keep the app small and runnable.
- Model provider: the local Claude Code CLI behind `callModel()` in `server/llm.js`, as the
  experiment required. Flags: `-p`, `--output-format json`, `--json-schema` (structured output,
  read from `structured_output`, with a fallback that parses JSON out of `result`),
  `--system-prompt`, and `--tools ""` (no tool use). `CLAUDECODE` is removed from the environment. The CLI's default model is used unless `CLAUDE_MODEL` is set. The timeout is 180 s.
- Validation: a JSON schema goes to the CLI, and hand-written validators in
  `server/operations.js` run after it. They drop unknown ids, clamp lengths, force exactly
  one player, keep suggestions to engine-legal actions, and drop scripts or effects that
  reference missing entities. No zod.
- Tests: `node:test`. The tests cover the templates' geometry, layout, engine play-through and immutability, and script validation. Headless Chromium via playwright-core was used only for a manual walk-through and is not a project dependency.
- Persistence: the project is autosaved to `localStorage` and can be exported or imported as JSON. Play state is in memory only.

## 3. Data formats

- Map: a 16×10 tile grid. Regions are rectangles with a `kind` (indoor/outdoor/road/water/forest) that sets the colour. Regions sharing an edge are adjacent, and "go" works only between adjacent regions.
- Character: `{id, name, description, emoji, color, isPlayer, persona, trait}`. Emoji are used as sprites.
- Object: `{id, name, description, emoji, region, affordances ⊆ [take,use,open], owner, hidden}`.
- Verbs: `go, look, take, use, open, talk, give` (give takes an `item`).
- Script: `{id, title, eventId, trigger:{verb,target,item?}, requires:[flag], effects:[…], repeatable, npc, region}`.
  Effects: `narrate, set_flag, give_item, remove_object, reveal_object, move_character, end_story`.
  Story order comes from flags.
- Built-in engine rules (these count as `matched` with no script): go to an adjacent region, look, and take objects that have the `take` affordance.
- Game state: `{turn, positions, inventory, flags, fired, removed, hidden, ended, log}`.
  `applyRule` never mutates; earlier states are kept for **Undo**.
- What the model `assign` steps assign (the design only says "assign"): region names (r5), object affordances, owner and hidden flag (r6_2), and for each script its voicing NPC and region (r13_2).

## 4. Model prompts

There is one prompt per model operation, all in `server/operations.js`, sharing one short system prompt ("component of an application that turns a story into a small playable 2D world… respond only with JSON"). Each prompt is built from the representations in the state before its step, with these deviations:
- `improviseNarration` (process 6) also receives the label of the action that was evaluated. In the design, r18 is no longer in the state after `tool_2 evaluate`, but narrating a verdict without knowing the action made no sense.
- `suggestActions` gets the engine's list of legal actions, which is derived from r14 + r15, and the state as text. It does not get the rendered image r16.
- `extractCharacters` receives only the names of the templates (r2*). The templates barely matter for extraction.
- `characterReply` and `improviseNarration` get no story text, because r1 is absent in processes 5 and 6.
- Length and count constraints: 2–6 characters, 4–12 objects, 3–10 events, 5 trait labels of 1–3 words, 3–4 suggestions, 1–3 sentence replies. These are stated in the prompts and also enforced in the validators.

## 5. Layout, styling, interaction

- A dark header with four numbered tabs. Tabs unlock as their inputs exist. The header also has Export, Import and New buttons.
- The main column holds the primary artifact. A 380–400 px side column holds labels, characters and logs.
- Warm paper palette with Georgia headings. Badges mark steps as "AI" (purple), "you" (green) or "engine" (brown). Purple text in the play log marks lines the AI improvised that did not change the world.
- Model chains run automatically up to the next human step. In process 1 that is extract → select → assign, then a pause for name editing, then generate → layout → assign. In process 3 it is extract → compose → assign. Every generative step has a spinner and a regenerate button ("Pick another map", "Suggest names again", "Regenerate objects", "Regenerate persona", "Suggest other traits", "Rebuild scripts").
- Direct manipulation: tokens are dragged on the map canvas, and a dropped object's region updates. Every model output is shown as editable fields before it is used downstream.
- Any edit upstream marks the compiled game as stale, and you must compile again.
- Play: a canvas with a speech-bubble overlay for process 5 and a narration-banner overlay for process 6. There are suggestion buttons, a verb/target form, a "Say" field (only characters in the same room), and Undo, Restart, and "End story & make storybook", which produces a PNG download.
- A built-in example story ("The Lantern of Marrow Bay") is written for this app.

## 6. Verification

- `npm run check` passes (syntax of all 15 JS files). `npm test` passes 5/5.
- All 13 model operations were called against the real CLI through the HTTP API.
- A headless-Chromium walk-through reached every transformation in processes 1–6: build world, edit a place name, populate, drag a token, persona → traits → select → apply, scripts → compile, a suggestion click (matched, loop), an invalid action (improvised narration), Say (character reply), and the storybook. It found and fixed two bugs: duplicate element ids across hidden tabs, and the Say field being cleared when a background re-render ran.
- Known limits: the model can write scripts the player cannot complete, for example when a trigger targets an object that is still hidden. The script editor is where to fix that. Scripts are not checked for reachability.

## 7. Did the design remind me of a published system?

Not of one specific system with confidence. The design has no names, descriptions or references, so the "story → playable world" reading is an inference from the structure. I can't rule out other readings, such as text → infographic or slide layout (a spatial template is selected, elements are labelled, generated and placed, then rendered and exported), or text → 3D scene.

That said, once I leaned toward a game reading, it was shaped by my general knowledge of
LLM story-to-game research. The closest I know is **Word2World** (Nasir et al., 2024),
which turns a story into a playable 2D tile world by extracting characters, picking tiles
and placing them, and setting objectives. I also had in mind LLM-driven interactive
fiction and NPC dialogue systems in general (for example Generative Agents' sandbox and
LLM text adventures). I did not consult any of them. These choices came from that
background knowledge, not from the design:

- Reading r1 as a narrative story, r3 as characters, and r12/r13 as story events turned into game objectives or scripts.
- A tile-grid map rendered top-down with emoji sprites, and region-based worlds.
- Text-adventure verbs (go/look/take/use/open/talk/give), inventory and flag-chained quests.
- Using the model to voice NPCs in character (process 5) and to improvise narration when the player goes "off script" (process 6). This is a common pattern in LLM interactive fiction. The design only says the visual changes while the state does not.
- The "storybook" ending image (r20) is my own invention to fill an otherwise undescribed final visual.
