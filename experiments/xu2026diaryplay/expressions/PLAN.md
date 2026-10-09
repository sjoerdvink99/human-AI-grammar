# PLAN — System X (story → playable vignette)

The design has no goal, descriptions, representation notes, references or images. I read it as
an **authoring + play tool**: an author pastes a short story; the system builds a top‑down
tile world (floor plan, rooms, objects), characters, and a sequence of plot events from it,
packages everything as a *vignette*, and then lets a player play one character in it while
the other characters (NPCs) are driven by a model. The player can chat with NPCs, and an
"inner voice" nudges them when they drift from the plot.

Processes become four tabs of one app, sharing one project state:

| Tab | Processes |
| --- | --- |
| 1 World | process 1 (characters, layout, rooms, objects, environment editor) |
| 2 Characters | end of process 1 (`characters_1 → characters_2` editor) + process 2 (character interview) |
| 3 Plot | process 3 (activities, events, vignette) |
| 4 Play | process 4 (game loop) + process 5 (talk to NPC) + process 6 (inner voice) |

## Stack (repository was empty)

- Vite + React + TypeScript frontend (`src/`), Express + TypeScript backend (`server/`, run with `tsx`).
- All model steps go through one function `callModel()` in `server/llm.ts`, which spawns
  `claude -p --output-format json --json-schema …` with `CLAUDECODE` removed from the env.
- Persistence: project state in `localStorage`, plus JSON export/import.
- Tests: Vitest for deterministic tools (tool_1, tool_2) and validators.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| story | `string` | the source story text | `src/types.ts` |
| layouts | `Layout[]` | built-in floor plans: grid size, rectangular rooms, doors | `src/shared/layouts.ts` |
| layout | `Layout` | the chosen floor plan | `src/types.ts` |
| characters | `Character[]` | id, name, description, traits[], isPlayer, color, start position | `src/types.ts` |
| room_labels | `RoomLabel[]` | roomId → name + short description | `src/types.ts` |
| objects | `GameObject[]` | id, name, emoji, description, roomId, x, y | `src/types.ts` |
| environment | `Environment` | tile grid (wall/floor/door), rooms with labels | `src/types.ts` |
| message | `string` | author's interview question to a character | `CharacterInterview.tsx` |
| reply | `string` (v1 model, v2 edited) | character's in‑voice answer | `CharacterInterview.tsx` |
| traits | `string[]` | suggested personality traits from the reply | `CharacterInterview.tsx` |
| trait_choice | `string` | the chosen trait | `CharacterInterview.tsx` |
| activities | `Activity[]` | id, objectId, verb, description | `src/types.ts` |
| events | `PlotEvent[]` | id, order, description, activityId, roomId, characterIds | `src/types.ts` |
| vignette | `Vignette` | environment + objects + characters + events + activities + player id + title/ending | `src/types.ts` |
| runtime_state | `RuntimeState` | positions, current event index, completed events, tick, log, dialogue | `src/types.ts` |
| scene | canvas rendering | tile map + objects + characters + speech bubbles | `src/components/SceneCanvas.tsx` |
| npc_plans | `NpcPlan[]` | per NPC: queue of steps (moveTo object / do activity / wait / say) | `src/types.ts` |
| player_action | `PlayerAction` | {type: move/interact/wait, dir?, objectId?, activityId?} | `src/types.ts` |
| npc_activity | `NpcStep[]` | the one step each NPC executes this tick | `src/shared/engine.ts` |
| end_screen | React view | summary of events and log | `src/components/EndScreen.tsx` |
| player_message | `string` | player's line to an adjacent NPC | `PlayView.tsx` |
| npc_reply | `string` | NPC's answer | `PlayView.tsx` |
| deviation | `'on_track' \| 'minor' \| 'major'` | how far the action is from the current event | `src/shared/engine.ts` |
| inner_voice | `string` | short second‑person nudge | `PlayView.tsx` |

## Transformations

| # | actor op | implementation | file |
| --- | --- | --- | --- |
| P1.1 | model extract | `extractCharacters` → POST `/api/extract-characters` | `server/operations.ts` |
| P1.2 | model select | `selectLayout` (chosen id validated against library) | `server/operations.ts` |
| P1.3 | model assign | `assignRoomLabels` (one label per room, validated) | `server/operations.ts` |
| P1.4 | human modify | room label inputs over the layout preview | `src/components/WorldTab.tsx` |
| P1.5 | model generate~ | `generateObjects` (roomIds validated) | `server/operations.ts` |
| P1.6 | tool_1 execute | `buildEnvironment(layout, labels)` | `src/shared/environment.ts` |
| P1.7 | model assign | `placeObjects` (positions clamped/snapped by `snapObjects`) | `server/operations.ts` |
| P1.8 | human modify | tile painting + object dragging/editing on the canvas | `src/components/WorldTab.tsx` |
| P1.9 | human modify | character editor (fields, player toggle, place on map) | `src/components/CharactersTab.tsx` |
| P2.1 | human specify | interview question field | `CharacterInterview.tsx` |
| P2.2 | model generate~ | `interviewReply` | `server/operations.ts` |
| P2.3 | human modify | editable reply text | `CharacterInterview.tsx` |
| P2.4 | model generate~ | `suggestTraits` | `server/operations.ts` |
| P2.5 | human select | trait chips | `CharacterInterview.tsx` |
| P2.6 | human modify | "Add to character" (editable trait) → characters_3 | `CharacterInterview.tsx` |
| P3.1 | model extract | `extractActivities` | `server/operations.ts` |
| P3.2 | model compose | `composeEvents` | `server/operations.ts` |
| P3.3 | model assign | `assignEventCharacters` | `server/operations.ts` |
| P3.4 | human modify | event list editor (reorder, edit, delete, add) | `src/components/PlotTab.tsx` |
| P3.5 | tool_2 compose | `composeVignette` | `src/shared/engine.ts` |
| P4.1 | tool_2 execute | `initRuntime` + `SceneCanvas` | `src/shared/engine.ts` |
| P4.2 | model generate~ | `planNpcs` | `server/operations.ts` |
| P4.3 | human specify | arrow keys / interact menu / wait | `src/components/PlayView.tsx` |
| P4.4 | tool_2 select | `selectNpcActivity` | `src/shared/engine.ts` |
| P4.5 | tool_2 execute | `step` → loops back to scene | `src/shared/engine.ts` |
| P4.6 | tool_2 execute | `isFinished` → `EndScreen` | `src/shared/engine.ts` |
| P5.1–3 | human specify / model generate~ / tool_2 execute | chat box → `npcReply` → speech bubble + log | `PlayView.tsx`, `server/operations.ts` |
| P6.1–3 | tool_2 evaluate / model generate~ / tool_2 execute | `evaluateDeviation` → `innerVoice` → overlay | `src/shared/engine.ts`, `server/operations.ts` |

## Open choices and defaults taken

- Provider: Claude Code CLI behind `callModel()`; authoring calls use the default model, in‑game calls (P4.2, P5.2, P6.2) use `haiku` for latency (override with env vars).
- Persistence: localStorage + JSON export/import, no database.
- Layout: four tabs; canvas tile rendering with emoji objects and coloured character tokens.
- P4 loop: the model re‑plans NPCs when their plan queue is empty or the current event changes, rather than on every tick (latency); the loop itself runs every player action.
- P6 trigger: after every player action that `evaluateDeviation` rates `minor`/`major`, throttled to at most one inner voice per 4 ticks for `minor`.
- No steps added beyond the design.
