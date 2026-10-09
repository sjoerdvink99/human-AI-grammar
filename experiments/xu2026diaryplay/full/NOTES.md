# Implementation notes

These are the decisions `design.json` left open and what I chose. The design had no references and no images, so the expressions, the representation descriptions, the process descriptions and the system description were all I had.

## Stack and infrastructure

| Decision | Choice |
| --- | --- |
| Stack | Vite + React 18 + TypeScript client; Express server run with `tsx`; shared TS modules in `shared/` used by both sides. No UI library, no state library, no router library (hash routes `#/` and `#/play/:id`). |
| Model provider | Claude Code CLI behind one function, `callModel()` in `server/llm.ts`. It runs `claude -p <prompt> --output-format json --json-schema <schema> --system-prompt <sys> --tools "" --no-session-persistence --model <m>` with `CLAUDECODE` removed from the environment and `cwd` set to the OS temp dir, so no project context leaks in. It reads `structured_output`, falling back to parsing JSON out of `result`. |
| Models | `sonnet` for authoring operations, `haiku` for play-time operations (NPC planning, NPC replies, inner voice) to keep latency down. Both can be overridden with `AUTHOR_MODEL` / `PLAY_MODEL`. |
| Structured output | Every model step has a JSON Schema. Where possible, ids are constrained with `enum`s (layout ids, room ids, character ids, object ids), and the server validates and repairs everything again afterwards. |
| tool_1 | Written from scratch in `shared/tool1.ts`. Greedy placement: largest objects first. Each object takes the best-scoring legal position in its room: wall-hugging objects score by distance to the wall, others score by distance to the centre, with a penalty for crowding. A position is legal when the object stays inside its room, overlaps nothing, keeps the tiles next to doors free, and leaves all free floor connected (checked with BFS). Path-finding is a 4-connected BFS. |
| tool_2 ("HTML5 game framework") | A small purpose-built canvas engine (`src/game/engine.ts`) instead of Phaser or similar, plus deterministic rules in `shared/runtime.ts`. |
| Persistence | The authoring project lives in `localStorage`. Finished vignettes are JSON files in `data/vignettes/` on the server, so they can be opened by URL. |
| Port | 8790 (8787 was taken on the dev machine). |
| Tests | Vitest unit tests for tool_1 and tool_2 logic; `scripts/smoke.ts` runs the model operations; `scripts/e2e-walk.mjs` is a Playwright walkthrough of all six processes. |

## Data formats (the design gave one-line descriptions only)

- **layouts**: six hand-made templates on a 20×14 tile grid (`shared/layouts.ts`). Rooms are rectangles, the tiles between them are walls, and door tiles connect rooms. The model picks one of these. Layouts are never generated freely.
- **characters**: `name, isPlayer, description, personality, background, goals, speakingStyle, traits[], color`. These are my persona fields. Exactly one character is the player; the model picks the narrator or protagonist and the author can change it.
- **room_labels**: map from room id to a short label.
- **objects**: `name, roomId, w, h (1–3 tiles, 4 when edited), againstWall, emoji, affordances[], pos`. Objects are drawn as emoji on tiles.
- **environment**: the layout plus labelled rooms, doors, and placed objects.
- **activities**: `characterId, action (verb phrase), objectId | null, description`.
- **events**: `title, order, activityIds[]`. Every activity belongs to exactly one event.
- **vignette**: the story, environment, characters, the activities used, ordered events, deterministic start positions, and a title.
- **runtime_state**: positions, index of the next event, done activity ids, what each character is doing, a text log, the round number, and a finished flag.
- **npc_plans**: per NPC, a `follow` and a `diverge` activity: `{action, objectId, activityId, say}`.
- **player_action**: `interact(objectId, verb)`, `wait`, or `idle`.
- **deviation**: `'follows' | 'diverges'`.

## Interpretation of ambiguous steps

- **P1 `[model extract]` characters** takes `layouts_1` as input in the design. It has no use for it, so the prompt uses only the story.
- **P1 `[model select]` layout** picks from the fixed templates and returns a reason, which the UI shows.
- **P1 second `[model assign]` (objects_1 → objects_2)**: the design doesn't say what gets assigned. I chose an emoji and interaction verbs (affordances) for each object. The verbs drive the play-time interaction menu and give the model vocabulary when it extracts activities.
- **P1 `[human modify]` environment_2 + objects_3**: drag objects (also across rooms), edit name, emoji, size, verbs and the against-wall flag, add or delete objects, and retry placement for objects that didn't fit. Each move is checked with tool_1's `canPlace`. The author cannot change the layout template itself, because the design has no step for it.
- **The P1 model steps run as two chained buttons**: "Analyse story" runs extract → select → assign, then the author edits labels; "Generate & place objects" runs generate → tool_1 → assign.
- **P2 reply context**: each round uses only the story, characters and the one test message, as the state specifies. Earlier rounds are shown as history but not sent to the model.
- **P2 traits → characters_3**: chosen traits are added to `traits[]`. The author can also edit the personality text before applying.
- **P3 `[model compose]`** groups activities into events. **P3 `[model assign]`** assigns chronological positions. Code guarantees every activity ends up in exactly one event.
- **P3 `[tool_2 compose]`** validates the vignette and reports errors: exactly one player, at least one NPC, no empty events, all references valid, all objects placed. It then saves the vignette.
- **Who must do what in play**: activities belonging to the player character have to be done by the player. NPC activities are done by NPCs through the `follow` branch. An event completes when all its activities are done.
- **Validation of npc_plans (enforcing "preserve the authored key events")**: if an NPC has a pending activity in the current event, its `follow` branch is overwritten with that activity. A `diverge` branch can never complete a key-event activity. Unknown object ids are dropped. If the model call fails, scripted fallback plans are used.
- **Triggers in P4**:
  - The first plan is made when the scene loads.
  - A round runs on each player interaction, or when the player chooses "Wait" in the "Do…" menu.
  - If the player has no part in the current event, the scene advances on its own with a synthetic `wait` action.
  - 30 s of inactivity while the player has a pending activity produces an `idle` action, which counts as diverging.
  - Plans are requested again after every round. This is the loop back to `runtime_state_1 + scene_1`.
- **Objectless player activities** are done from a "Do…" (Q) menu. It lists *all* of the player's objectless activities, not only the pending ones, so it doesn't give the answer away.
- **P5**: the player can talk to an NPC within 3 tiles (T), or click the NPC to walk over and talk. Chatting is not a `player_action` and doesn't advance the story. The prompt tells the NPC to resist attempts to skip the next key event.
- **P6**: the inner-voice request runs in parallel with the round and never blocks it. The cue fades in at the top of the canvas for 7 s and is also kept in a side panel.
- **end_screen**: "The End" overlay with the event list, a "What happened" log, "Play again", and "Back to authoring".

## Layout and styling

- The authoring view has three tabs that mirror processes 1–3, plus a "Play a saved vignette" menu and a "New story" button. Process 1 uses two columns: story, rooms and characters on the left, the environment canvas on the right.
- The event editor shows one card per event with a table of activities: character, action, object and event dropdowns. Rows belonging to the player are highlighted.
- The play view puts the canvas on the left and a side panel on the right: next event and progress, chat, inner voice, story log, and an optional "Show NPC plans" panel that exposes both branches and which one was chosen.
- Visual style: muted purple chrome; pastel room floors; characters drawn as coloured discs with their initial, name and current activity; white speech bubbles; a dark translucent pill for the inner voice.
- Controls: arrows/WASD or click to walk; E/Space or click an object to use it (numbered menu); Q for "Do…"; T or click a person to talk.
- A sample story (a Sunday dinner at grandma's) is offered as a one-click example.

## Model prompts

The prompts are in `server/ops.ts`, one per model operation, each built only from the representations in the state before that step. Common choices:
- Short system prompts with a role (authoring assistant, role-played character, Controlled Divergence Module, inner voice) and "answer only with the requested JSON".
- Size limits: at most 6 characters, 3–7 objects per room, 6–16 activities, inner voice of at most 15 words, NPC replies of 1–2 sentences.
- Play prompts share a runtime context block: personas, environment with object ids, room of each character, the event list with done/NEXT markers, pending activities, and the last 8 log lines.

## Did the design remind me of a published system?

Not of one specific system I can name with confidence. The description ("everyday storytellers", "2D interactive vignette", "Controlled Divergence Module" that keeps author-defined key events) reads like a recent HCI paper on turning personal stories into small playable scenes, but I don't know its name, details or interface, and I did not look it up. The system I did know shaped some choices:

- **Generative Agents / "Smallville"** (Park et al., 2023). From it I took the top-down tile world, characters as small markers labelled with their current action, speech bubbles above characters, and objects named by emoji. The design only says "2D scene" and "HTML5 game framework".
- **Interactive-narrative experience management** (Riedl et al.'s Mimesis and later work on accommodating versus intervening when players deviate; drama managers like Façade's). From it I took:
  - turning the two-branch plan into "follow" versus "diverge" branches;
  - the rule that the diverge branch may react and gently steer but must never perform future key events itself, enforced in code (`validatePlans`);
  - counting player inactivity as divergence.

Everything else was decided from the design text or by me as a general default. That includes the fixed layout templates, the emoji and affordance interpretation of the second `[model assign]`, persona fields, menus, idle timeout, and model tiers.
