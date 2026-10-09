# Story World (implementation of `design.json`, "System X")

Paste a story → the AI builds a small 2D tile world from it (characters, a map, named
places, objects) → you refine characters → the AI turns the story's events into game
scripts that you can edit → a deterministic engine runs the world and you **play the
story**, with the AI suggesting actions, improvising where no script applies, and voicing
characters you talk to. At the end the engine draws a storybook image of your play-through.

## Run

```bash
npm install
npm start            # http://localhost:5173  (PORT=… to change)
npm test             # engine / layout / validation tests (node --test)
npm run check        # syntax check of all JS (no build step)
```

Requires the Claude Code CLI (`claude`) on `PATH`, logged in. Every model step calls
`claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from
the environment. Optional env: `CLAUDE_MODEL` (e.g. `sonnet`), `CLAUDE_BIN`, `MODEL_TIMEOUT_MS`.
To use another provider, reimplement `callModel()` in `server/llm.js`; nothing else changes.

## Layout

```
server/llm.js          callModel(): the single model-provider function
server/operations.js   one function per [model …] step: prompt + JSON schema + validation
server/index.js        Express: static files + POST /api/model/<operation>
public/data/templates.js   r2* map templates
public/tools/layout.js     tool_1 (placement)
public/tools/engine.js     tool_2 (compose / execute / select / evaluate)
public/tools/render.js     tool_2 visual output (r16 view, r20 storybook)
public/views/*.js          one view per process (World, Characters, Scripts, Play)
```

## Design → code

Identifiers `rN` in `design.json` are given readable names in code (see `PLAN.md` for the
full representation table).

| Process | Step | Code |
| --- | --- | --- |
| 1 World | `[model extract]` story + templates → characters (r3*) | `extractCharacters` — `server/operations.js` |
| 1 | `[model select]` → map (r4) | `selectTemplate` — `server/operations.js` |
| 1 | `[model assign]` → region labels (r5*) | `assignRegionLabels` — `server/operations.js` |
| 1 | `[human modify]` r5 | "Places" inputs — `public/views/world.js` |
| 1 | `[model generate]~` → objects (r6*) | `generateObjects` — `server/operations.js` |
| 1 | `[tool_1 execute]` → placement (r7) | `layoutWorld` — `public/tools/layout.js` |
| 1 | `[model assign]` r6_1 → r6_2 | `assignAffordances` — `server/operations.js` |
| 1 | `[human modify]` r7, r6 | drag on map canvas, objects table — `public/views/world.js` |
| 1 | `[human modify]` r3 | characters panel — `public/views/world.js` |
| 2 Characters | `[human specify]` request (r8) | request field — `public/views/characters.js` |
| 2 | `[model generate]~` persona (r9) | `generateProfile` |
| 2 | `[human modify]` r9 | persona textarea |
| 2 | `[model generate]~` trait options (r10*) | `generateTraits` |
| 2 | `[human select]` trait (r11) | trait chips |
| 2 | `[human modify]` r3_2 → r3_3 | "Apply to character" |
| 3 Scripts | `[model extract]` events (r12*) | `extractEvents` |
| 3 | `[model compose]` scripts (r13*) | `composeScripts` (+ `validateScripts`) |
| 3 | `[model assign]` npc/region per script | `assignScripts` |
| 3 | `[human modify]` r13 | script editor — `public/views/scripts.js` |
| 3 | `[tool_2 compose]` → game spec (r14) | `composeGame` — `public/tools/engine.js` |
| 4 Play | `[tool_2 execute]` → state (r15) + view (r16) | `startGame`, `renderView` |
| 4 | `[model generate]~` suggestions (r17*) | `suggestActions` (restricted to engine-legal actions) |
| 4 | `[human specify]` action (r18) | suggestion buttons / verb+target form — `public/views/play.js` |
| 4 | `[tool_2 select]` → rule (r19) | `selectRule` |
| 4 | `[tool_2 execute]` (loop) | `applyRule` + re-render; suggestions refresh each turn |
| 4 | `[tool_2 execute]` → storybook (r20) | `renderStorybook` ("End story & make storybook") |
| 5 Talk | `[human specify]` utterance (r21) | "Say something" field |
| 5 | `[model generate]~` reply (r22) | `characterReply` |
| 5 | `[tool_2 execute]` → view (r16_2) | `renderView` with speech bubble |
| 6 Improvise | `[tool_2 evaluate]` → verdict (r23) | `evaluateAction` (`matched` / `unscripted` / `invalid`) |
| 6 | `[model generate]~` narration (r24) | `improviseNarration` |
| 6 | `[tool_2 execute]` → view (r16_3) | `renderView` with narration banner |
