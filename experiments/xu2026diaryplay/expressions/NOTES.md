# NOTES — decisions the design did not determine

The design names six processes and their representations. Its goal, descriptions, representation notes, references and images are all empty. So the interpretation itself was my decision too: **an authoring tool that turns a short story into a small, playable, top-down vignette game, plus a player for it.** Everything below follows from that reading.

## Overall interpretation

| Open question | Choice |
| --- | --- |
| What the system is for | Turning a story into a playable "vignette": a tile-based world, characters, objects with activities, and an ordered plot. One character is played; the others are model-driven NPCs. |
| How processes fit together | Four tabs over one shared project state: **World** (P1), **Characters** (end of P1 + P2), **Plot** (P3), **Play** (P4 with P5 and P6 inside it). Tabs unlock as prerequisites exist. |
| What triggers each process | P1–P3 run step by step from buttons. P4 starts when the Play tab opens or on Restart. P5 runs when the player submits a line to a nearby NPC. P6 runs automatically after a player action that is off-plot (see below). |
| `layouts_1` (spatial collection) | A built-in library of 5 rectangular-room floor plans (2–6 rooms) in `src/shared/layouts.ts`. The design has no way to add or draw layouts, so none is offered. The P1.1 extract prompt only uses the story; layouts are carried along. |
| `environment` (spatial) | A tile grid (`void/wall/floor/door`) plus room rectangles with names and descriptions. Walls are generated around room rectangles; doors come from the layout. |
| `characters` record fields | id, name, description, traits[], isPlayer, color, start x/y. |
| `objects` record fields | id, name, single emoji (its visual), description, roomId, x/y. Objects block movement. |
| `activities` | id, objectId, verb phrase, description. A character must stand next to (Chebyshev ≤ 1) the object to perform it. |
| `events` | id, description, completion condition (`activityId` **or** `roomId` **or** neither = "a moment passes", i.e. 2 ticks), characterIds. Events are strictly sequential. |
| `vignette` | A snapshot of title, story, environment, objects, characters (auto-placed if no start position), activities, events, playerId. Invalid references are dropped by `composeVignette`, and problems are listed instead of composing a broken vignette. |
| `runtime_state` | tick, positions, eventIndex, completed events, performed activities, speech bubbles, log, finished flag, deviation streak, last inner-voice tick. |
| `scene` (visual) | An HTML canvas render: room-tinted floors, dark walls, brown doors, room names, emoji objects, coloured initial tokens (white ring = player), and speech bubbles. |
| `npc_plans` | Per NPC, a queue of up to 4 steps: `goto object`, `activity` (walks there first), `say`, `wait`. |
| `player_action` | `move(dx,dy)`, `interact(activityId)` or `wait`. |
| `npc_activity` | The head of each NPC's plan this tick. If an NPC has no plan, it falls back to performing the current event's activity, but only when it takes part and the player doesn't. |
| `deviation` (categorical) | `on_track` / `minor` / `major`. Rules: an action that moves the player closer (BFS distance) to the current event's target, or performs its activity, is on track. Waiting or moving away while involved is minor. Performing a *future* event's activity, or 4 off-track actions in a row, is major. When the player isn't involved in the current event, any action is on track (except future-event activities). |
| `end_screen` | A summary card: turns, dialogue count, inner-voice count, completed events, full transcript, and Play again. |
| `message`, `reply`, `traits`, `trait_choice`, `player_message`, `npc_reply`, `inner_voice` | Plain strings. Interview Q&A history is kept in component state only. |

## Loops, versions and generative handling

- **P4 loop.** The loop runs once per player action: select → execute → back to the scene. The design loops back to the state *before* `[model generate]` (NPC plans). Calling the model on every tick would make each keypress take 5+ s, so NPC plans are **regenerated only when the current event changes, or when all current plans are used up and at least 3 ticks have passed**. The player is never blocked while plans load; NPCs wait in the meantime. This is the largest deliberate departure from a literal reading.
- **P6 trigger.** An inner voice is generated on every `major` deviation (at most once per 2 ticks). On `minor`, it is generated only after 2+ consecutive off-track actions, and at most once per 4 ticks.
- **P5 target.** `player_message` has no addressee in the design. The UI offers a dropdown of NPCs within 2 tiles, defaulting to the nearest. Talking does not advance the tick.
- **Versions.** `room_labels_1` (the model suggestion) is kept so the author can revert to it. `reply_1` is kept so an edited `reply_2` can be reverted. Earlier interview answers are listed. Rerunning a step **clears downstream steps** after a confirm dialog.
- **`~` steps.** Each async step shows a spinner and its label. Errors appear inline and can be dismissed. Every generative step can be regenerated. All model output uses `--json-schema` structured output, and is then validated in code: ids are checked against enums and against the real ids, text is trimmed and length-capped, duplicates are removed, and fallbacks are used (e.g. a default layout, `Room n`). Object positions are snapped onto free floor tiles in the right room by `snapObjects`.
- **P3.2 → P3.3** run back to back from one button, since no human step lies between them. The same goes for **P1.6 → P1.7**.
- **P4.6.** The engine marks the game finished when the last event completes. There is no time limit and no failure state.

## Model prompts (summary)

All prompts share a system prefix: *"You are a component of a tool that turns a short story into a small playable top-down vignette game… Stay faithful to the story."* Each operation then adds its own task line. Each user prompt contains only the representations in that step's preceding state (story, character list, room list with coordinates, objects, activities, events, or a runtime summary with positions and the last 10 log lines). Full text is in `server/operations.ts`. Notable specifics:

- Characters: 1–6, exactly one protagonist. The protagonist becomes the default player.
- Layout: the id is constrained by an enum over the library, plus a one-sentence reason shown in the UI.
- Objects: 2–5 per room, one emoji each, must include objects the plot needs.
- Placement: wall furniture on edges, door neighbours kept free, no overlaps.
- Interview: first-person answer in 1–4 sentences. Traits: 3–6 short, not repeating existing ones.
- Events: 3–8 present-tense sentences, each completed by an activity or by reaching a room.
- NPC plans / NPC reply / inner voice: the full vignette + runtime summary. Inner voice is "one short second-person thought, max 25 words", more insistent on `major`.

## Libraries, stack, styling

- Vite + React 18 + TypeScript. Express server run with `tsx`. Vitest for the deterministic tools. No UI or state library: React state plus `localStorage`, with JSON export/import.
- Provider: Claude Code CLI behind `callModel()` (`server/llm.ts`). It runs with `--tools ""`, a custom `--system-prompt`, and `cwd` set to the OS temp dir. Authoring calls use the CLI default model; in-game calls use `haiku` for latency. Both can be changed with env vars.
- Styling: hand-written CSS with a warm off-white background, a dark top bar and an orange accent. Steps go in the left panel and the canvas on the right; in Play the panel is on the right. Pathfinding is BFS on a 4-neighbour grid.
- Controls: arrows/WASD move, space waits, 1–9 performs a listed activity, T focuses the talk box.
- Sample story: an original lighthouse-cottage story, so the app can be tried immediately.

## Verification done

- `tsc --noEmit`, `vite build`, and `vitest` (5 tests covering tool_1/tool_2, including a full playthrough to the end screen) all pass.
- Every model endpoint (P1.1, 1.2, 1.3, 1.5, 1.7, 2.2, 2.4, 3.1, 3.2, 3.3, 4.2, 5.2, 6.2) was called once through the running server and real CLI on the sample story, and returned valid, validated output (3–13 s per call).
- The UI was compiled and served, but I had no browser available to click through it. Human steps (P1.4, P1.8, P1.9, P2.1/2.3/2.5/2.6, P3.4, P4.3, P5.1) are therefore verified by type checking and code review, not by an interactive walkthrough.

## Did the design remind me of a published system?

Partly. The **runtime half** (a top-down tile world with named rooms and objects, objects that afford activities, model-generated NPC plans executed step by step by a game engine, speech bubbles) strongly reminded me of **Generative Agents (Park et al., UIST 2023, "Smallville")**. These choices come from that knowledge, not from the design:
- emoji objects and coloured character tokens on a tile map
- activities attached to objects and performed by standing next to them
- NPC plans as short queues of goto/act/say steps
- speech bubbles over characters

The **authoring half** (story → characters → layout selection → room labelling → object generation → placement → plot events, then playing as one character with an "inner voice" when straying from the plot) felt like a specific recent HCI paper on turning narratives into playable vignettes or interactive scenes. I cannot name it with confidence, so I did not knowingly copy any of its particulars.

The choices below are my own, not taken from a known system:
- the 5-layout library
- the deviation rules
- the inner-voice throttling
- the event completion conditions
- the tab structure
