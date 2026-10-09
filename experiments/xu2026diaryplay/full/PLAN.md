# Implementation plan — System X (story → playable 2D vignette)

Design: `design.json` (6 processes, no references, no images). The plan was not confirmed interactively; per the experiment instructions the recommended defaults below were taken.

## Stack (repository was empty)

| Concern | Choice |
| --- | --- |
| Client | Vite + React 18 + TypeScript (`src/`) |
| Server | Node + Express, TypeScript run with `tsx` (`server/`) |
| Shared code | `shared/` — types, tool_1 algorithms, layout templates, runtime rules |
| Model provider | local Claude Code CLI: `claude -p --output-format json --json-schema … --tools ""`, spawned with `CLAUDECODE` removed, all behind `callModel()` in `server/llm.ts` |
| tool_1 | `shared/tool1.ts`: greedy object placement + BFS path-finding |
| tool_2 ("HTML5 game framework") | small purpose-built canvas engine `src/game/engine.ts` (render loop, sprites, movement, bubbles), plus `shared/runtime.ts` (compose / select / evaluate) |
| Persistence | authoring project in `localStorage`; finished vignettes saved to `data/vignettes/<id>.json` by the server |
| Tests | Vitest for tool_1 and tool_2 deterministic logic |

## Representations

| Identifier | Type (`shared/types.ts`) | Contents | Where it lives |
| --- | --- | --- | --- |
| story | `string` | short everyday story | `Project.story`, textarea in `StoryPanel` |
| layouts | `Layout[]` | predefined room-layout templates on a tile grid | `shared/layouts.ts` |
| layout | `Layout` | chosen template | `Project.layoutId` |
| characters | `Character[]` | name, isPlayer, description, personality, background, goals, speakingStyle, traits, color | `Project.characters`, `CharacterEditor` |
| room_labels | `Record<roomId,string>` | what each room is | `Project.roomLabels`, `RoomLabelEditor` |
| objects | `GameObject[]` | name, emoji, room, w/h, affordances, position | `Project.objects` (versions 1–3: generated → affordances assigned → human edited) |
| environment | `Environment` | layout + labelled rooms + walkable grid + placed objects | computed by tool_1, edited on `EnvironmentCanvas` |
| message / reply | `string` | author test line / character answer (editable) | `PersonaLab` |
| traits / trait_choice | `string[]` | suggested traits / author-kept traits | `PersonaLab` |
| activities | `Activity[]` | characterId, action, objectId | `Project.activities` |
| events | `KeyEvent[]` | ordered groups of concurrent activities | `Project.events`, `EventEditor` |
| vignette | `Vignette` | compiled playable scene (story, environment, characters, objects, events, start positions) | server `data/vignettes`, `Play` |
| runtime_state | `RuntimeState` | positions, next event index, done activities, log | `Play` (ref + React state) |
| scene | canvas | rendered 2D scene | `engine.ts` |
| npc_plans | `NpcPlan[]` | per NPC: `follow` and `diverge` activity | `Play` |
| player_action | `PlayerAction` | interact(objectId, verb) / talk / idle | keyboard + click handlers in `Play` |
| npc_activity | `PlannedActivity[]` | the chosen branch per NPC | `Play` |
| player_message / npc_reply | `string` | in-game chat | `ChatBox` |
| deviation | `'follows' \| 'diverges'` | tool_2 evaluate result | `shared/runtime.ts#evaluateDeviation` |
| inner_voice | `string` | short in-scene hint | overlay in canvas |
| end_screen | view | end card with log | `EndScreen` |

## Transformations (process order)

| # | Actor op | Function / component | File |
| --- | --- | --- | --- |
| P1.1 | model extract → characters | `extractCharacters` / `POST /api/p1/extract-characters` | `server/ops.ts` |
| P1.2 | model select → layout | `selectLayout` | `server/ops.ts` |
| P1.3 | model assign → room_labels | `assignRoomLabels` | `server/ops.ts` |
| P1.4 | human modify → room_labels_2 | `RoomLabelEditor` | `src/author/BuildPanel.tsx` |
| P1.5 | model generate~ → objects | `generateObjects` | `server/ops.ts` |
| P1.6 | tool_1 execute → environment | `placeObjects` | `shared/tool1.ts` |
| P1.7 | model assign → objects_2 (affordances + emoji) | `assignObjectAffordances` | `server/ops.ts` |
| P1.8 | human modify → environment_2 / objects_3 | drag/add/delete/edit on `EnvironmentCanvas` | `src/author/EnvironmentCanvas.tsx` |
| P1.9 | human modify → characters_2 | `CharacterEditor` | `src/author/BuildPanel.tsx` |
| P2.1 | human specify → message | input in `PersonaLab` | `src/author/PersonaLab.tsx` |
| P2.2 | model generate~ → reply | `personaReply` | `server/ops.ts` |
| P2.3 | human modify → reply_2 | editable reply | `PersonaLab` |
| P2.4 | model generate~ → traits | `suggestTraits` | `server/ops.ts` |
| P2.5 | human select → trait_choice | trait chips | `PersonaLab` |
| P2.6 | human modify → characters_3 | "Apply to persona" edits personality | `PersonaLab` |
| P3.1 | model extract → activities | `extractActivities` | `server/ops.ts` |
| P3.2 | model compose → events | `composeEvents` | `server/ops.ts` |
| P3.3 | model assign → events_2 (chronological order) | `orderEvents` | `server/ops.ts` |
| P3.4 | human modify → events_3 | `EventEditor` | `src/author/EventsPanel.tsx` |
| P3.5 | tool_2 compose → vignette | `composeVignette` | `shared/runtime.ts` |
| P4.1 | tool_2 execute → runtime_state + scene | `initRuntime` + `Engine` | `shared/runtime.ts`, `src/game/engine.ts` |
| P4.2 | model generate~ → npc_plans | `planNpcs` | `server/ops.ts` |
| P4.3 | human specify → player_action | keys / clicks | `src/play/Play.tsx` |
| P4.4 | tool_2 select → npc_activity | `selectNpcActivities` | `shared/runtime.ts` |
| P4.5 | tool_2 execute → updated scene (loop to P4.2) | `Engine.perform` + `applyActivities` | engine / runtime |
| P4.6 | tool_2 execute → end_screen | `EndScreen` | `src/play/Play.tsx` |
| P5.1 | human specify → player_message | `ChatBox` | `src/play/Play.tsx` |
| P5.2 | model generate~ → npc_reply | `npcReply` | `server/ops.ts` |
| P5.3 | tool_2 execute → scene_2 (speech bubble) | `Engine.say` | engine |
| P6.1 | tool_2 evaluate → deviation | `evaluateDeviation` | `shared/runtime.ts` |
| P6.2 | model generate~ → inner_voice | `innerVoice` | `server/ops.ts` |
| P6.3 | tool_2 execute → scene_3 (overlay, non-blocking) | `Engine.innerVoice` | engine |

## Images

None in the design.

## Open choices and defaults taken

- Provider: Claude Code CLI; `sonnet` for authoring ops, `haiku` for play ops (latency). Override via `AUTHOR_MODEL`, `PLAY_MODEL`.
- Layout: author view with three tabs (1 Environment & characters, 2 Persona lab, 3 Key events), a Play view.
- Player: the narrator/protagonist character (`isPlayer`), chosen by the model during extraction, editable.
- All interpretations of underspecified steps are listed in NOTES.md.
