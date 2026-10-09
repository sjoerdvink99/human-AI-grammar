# System X — Story → playable vignette

An implementation of `design.json` (Human-AI grammar). An author pastes a short story. The app builds a top-down tile world from it, along with characters and an ordered plot. The author can review and edit each step. Then a player plays one character while model-driven NPCs act out the story around them.

## Run

```bash
npm install
npm run dev        # API on :8787, UI on http://localhost:5173
npm test           # engine/tool tests (vitest)
npm run build      # typecheck + production build
npm start          # build, then serve UI + API on :8787
```

Model calls go through the locally installed Claude Code CLI (`claude -p --output-format json --json-schema …`, with `CLAUDECODE` removed from its environment). The only provider boundary is `callModel()` in `server/llm.ts`. Optional env vars: `MODEL_AUTHORING` (default: CLI default), `MODEL_RUNTIME` (default `haiku`, used for in-game calls), `MODEL_TIMEOUT_MS`, `PORT`.

## Design → code map

| Process / step | Grammar | Implementation |
| --- | --- | --- |
| P1.1 | `[model extract]` story → characters | `extractCharacters` in `server/operations.ts`; UI "Extract characters" in `src/components/WorldTab.tsx` |
| P1.2 | `[model select]` layouts → layout | `selectLayout` (`server/operations.ts`); library `src/shared/layouts.ts`; gallery in WorldTab |
| P1.3 | `[model assign]` → room_labels_1 | `assignRoomLabels` |
| P1.4 | `[human modify]` → room_labels_2 | room label inputs in WorldTab (with "Revert to suggestion") |
| P1.5 | `[model generate]~` → objects_1 | `generateObjects` |
| P1.6 | `[tool_1 execute]` → environment_1 | `buildEnvironment` in `src/shared/environment.ts` |
| P1.7 | `[model assign]` → objects_2 | `placeObjects` + validation `snapObjects` |
| P1.8 | `[human modify]` → environment_2, objects_3 | map editor in WorldTab (paint wall/floor/door, drag/add/edit/delete objects) |
| P1.9 | `[human modify]` → characters_2 | character editor in `src/components/CharactersTab.tsx` |
| P2.1 | `[human specify]` → message | question field in `src/components/CharacterInterview.tsx` |
| P2.2 | `[model generate]~` → reply_1 | `interviewReply` |
| P2.3 | `[human modify]` → reply_2 | editable answer (revert / regenerate) |
| P2.4 | `[model generate]~` → traits | `suggestTraits` |
| P2.5 | `[human select]` → trait_choice | trait chips |
| P2.6 | `[human modify]` → characters_3 | "Add to …" (editable trait) |
| P3.1 | `[model extract]` → activities | `extractActivities`; UI in `src/components/PlotTab.tsx` |
| P3.2 | `[model compose]` → events_1 | `composeEvents` |
| P3.3 | `[model assign]` → events_2 | `assignEventCharacters` (runs right after P3.2) |
| P3.4 | `[human modify]` → events_3 | event list editor (text, completion condition, characters, order, add/delete) |
| P3.5 | `[tool_2 compose]` → vignette | `composeVignette` in `src/shared/engine.ts` |
| P4.1 | `[tool_2 execute]` → runtime_state, scene | `initRuntime` + `SceneCanvas` (`src/components/PlayView.tsx`) |
| P4.2 | `[model generate]~` → npc_plans | `planNpcs`; re-planned in a PlayView effect |
| P4.3 | `[human specify]` → player_action | keyboard / buttons in PlayView |
| P4.4 | `[tool_2 select]` → npc_activity | `selectNpcActivity` |
| P4.5 | `[tool_2 execute]` (loop) | `step` |
| P4.6 | `[tool_2 execute]` → end_screen | `isFinished` + `src/components/EndScreen.tsx` |
| P5.1–5.3 | specify → `[model generate]~` → execute | Talk box → `npcReply` → `applyNpcReply` (speech bubbles + log) |
| P6.1–6.3 | `[tool_2 evaluate]` → `[model generate]~` → execute | `evaluateDeviation`/`shouldVoice` → `innerVoice` → `applyInnerVoice` (overlay + log) |

The project is saved in `localStorage` and can be exported and imported as JSON.
