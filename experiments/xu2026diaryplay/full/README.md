# Story Vignettes

Turn a short everyday story into a playable 2D interactive vignette. An author writes a story; a language model extracts characters, picks and labels a room layout, and proposes objects that a placement algorithm lays out. The author refines rooms, objects and personas (optionally by test-chatting with a character), and fixes the key events the model scheduled. Players then walk around the scene. A Controlled Divergence step plans each NPC's next move for two cases: the player follows the next key event, or does something else.

Implements `design.json` (Human-AI grammar design, 6 processes).

## Run

Requirements: Node 20+, and the Claude Code CLI (`claude`) installed and logged in. No API key is needed.

```bash
npm install
npm run dev        # server on :8790 + Vite client on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:8790
```

Environment variables: `PORT` (default 8790), `AUTHOR_MODEL` (default `sonnet`), `PLAY_MODEL` (default `haiku`), `CLAUDE_BIN`, `MODEL_TIMEOUT_MS`.

Checks: `npm run typecheck`, `npm test` (Vitest, deterministic tool_1/tool_2 logic), `npx tsx scripts/smoke.ts` (model ops end to end), `PLAYWRIGHT_DIR=<dir with playwright> node scripts/e2e-walk.mjs <shots>` (browser walkthrough of all processes; needs `npm start` running).

## Layout of the code

| Path | Contents |
| --- | --- |
| `shared/types.ts` | one type per design representation |
| `shared/layouts.ts` | `layouts` — the room-layout templates |
| `shared/tool1.ts` | tool_1: greedy placement, path-finding |
| `shared/runtime.ts` | tool_2 deterministic logic: compose, select, evaluate, state updates, plan validation |
| `server/llm.ts` | `callModel()` — the only provider call (Claude Code CLI) |
| `server/ops.ts` | one function per model operation (prompts + output validation) |
| `server/index.ts` | HTTP routes, vignette storage in `data/vignettes/` |
| `src/author/*` | authoring UI (processes 1–3) |
| `src/game/engine.ts` | tool_2 canvas game engine |
| `src/play/Play.tsx` | play UI (processes 4–6) |

## Design → code map

| Process | Step | Implemented by |
| --- | --- | --- |
| 1 Build environment & characters | `[model extract]` characters | `extractCharacters` in `server/ops.ts`, triggered by “Analyse story” in `src/author/BuildPanel.tsx` |
| | `[model select]` layout | `selectLayout` (`server/ops.ts`), chained after extraction |
| | `[model assign]` room_labels | `assignRoomLabels` (`server/ops.ts`), chained |
| | `[human modify]` room_labels_2 | room label inputs in `BuildPanel.tsx` |
| | `[model generate]~` objects | `generateObjects` (`server/ops.ts`), “Generate & place objects” |
| | `[tool_1 execute]` environment | `placeObjects` in `shared/tool1.ts` |
| | `[model assign]` objects_2 | `assignObjectAffordances` (`server/ops.ts`): emoji + interaction verbs |
| | `[human modify]` environment_2 + objects_3 | drag / edit / add / delete in `src/author/EnvironmentCanvas.tsx` |
| | `[human modify]` characters_2 | character cards in `BuildPanel.tsx` |
| 2 Refine a character | `[human specify]` message | input in `src/author/PersonaLab.tsx` |
| | `[model generate]~` reply | `personaReply` (`server/ops.ts`) |
| | `[human modify]` reply_2 | editable reply textarea (`PersonaLab.tsx`) |
| | `[model generate]~` traits | `suggestTraits` (`server/ops.ts`) |
| | `[human select]` trait_choice | trait chips (`PersonaLab.tsx`) |
| | `[human modify]` characters_3 | “Apply to persona” with editable personality (`PersonaLab.tsx`) |
| 3 Schedule key events | `[model extract]` activities | `extractActivities` (`server/ops.ts`), “Extract key events” in `src/author/EventsPanel.tsx` |
| | `[model compose]` events | `composeEvents` (`server/ops.ts`) |
| | `[model assign]` events_2 | `orderEvents` (`server/ops.ts`): chronological positions |
| | `[human modify]` events_3 | event/activity table editor (`EventsPanel.tsx`) |
| | `[tool_2 compose]` vignette | `composeVignette` in `shared/runtime.ts`, saved via `POST /api/vignettes` |
| 4 Play | `[tool_2 execute]` runtime_state + scene | `initRuntime` (`shared/runtime.ts`) + `Engine` (`src/game/engine.ts`) |
| | `[model generate]~` npc_plans | `planNpcs` (`server/ops.ts`) + `validatePlans` (`shared/runtime.ts`); `planCycle` in `src/play/Play.tsx` |
| | `[human specify]` player_action | keyboard / mouse handlers in `Play.tsx` (interact menu, “Do…” menu, idle timer) |
| | `[tool_2 select]` npc_activity | `selectNpcActivities` (`shared/runtime.ts`) |
| | `[tool_2 execute]` (loop) | `Engine.perform` + `applyRound`, then `planCycle` again (`Play.tsx`) |
| | `[tool_2 execute]` end_screen | `.endscreen` overlay in `Play.tsx` |
| 5 Converse with an NPC | `[human specify]` player_message | chat panel in `Play.tsx` |
| | `[model generate]~` npc_reply | `npcReply` (`server/ops.ts`) |
| | `[tool_2 execute]` scene_2 | `Engine.say` speech bubble |
| 6 Guide a diverging player | `[tool_2 evaluate]` deviation | `evaluateDeviation` (`shared/runtime.ts`) |
| | `[model generate]~` inner_voice | `innerVoice` (`server/ops.ts`) |
| | `[tool_2 execute]` scene_3 | `Engine.innerVoice` overlay (non-blocking) |
