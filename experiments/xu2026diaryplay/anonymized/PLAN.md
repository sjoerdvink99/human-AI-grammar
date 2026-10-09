# PLAN — System X

The design (`design.json`) has no goal, no descriptions, no representation
descriptions, no references and no images. Every identifier is opaque (`r1` … `r24`).
The interpretation below is therefore inferred purely from the structure of the six
processes (roles, media, operations, and how processes connect) and is my own
recommended default; it was not confirmed by the designer (the experiment instructions
say to take the default and continue).

## Interpretation

**Story → playable 2D world.** A user pastes a story (`r1`, the only representation
present in nearly every process). The system builds a tile map world from it, lets the
user refine the characters, compiles the story's events into game scripts, and finally
lets the user *play* the story as a small top-down text-adventure where a deterministic
engine (`tool_2`) runs the world and the model improvises where the scripts do not cover
the player's action.

Why this reading: `r2*` is a *collection* of spatial artifacts from which a model
*selects* one (→ map templates); records are extracted from text (→ characters); labels
are assigned to the chosen spatial artifact and edited by a human (→ region names);
more records are generated and a tool *executes* a placement producing a new spatial
artifact (→ objects placed on a map, which the human then drags). Process 3 *composes*
everything with a second tool into one record (→ a game spec), process 4 *executes* it
into a state record + a visual, loops over suggestions → human instruction record →
tool select → execute (→ a game loop), and ends with a final visual. Processes 5 and 6
change only the visual (`r16`), never the state (`r15`) → narrative/dialogue overlays.

## Stack (repository was empty)

- Node 20 + Express backend (`server/`) — serves the static frontend and exposes one
  POST endpoint per model operation.
- All model steps go through **one function** `callModel()` in `server/llm.js`, which
  runs `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE`
  removed from the environment. Swapping providers = rewriting that one function.
- Frontend: dependency-free vanilla JS ES modules + HTML canvas (`public/`), no build.
- `tool_1` (layout) and `tool_2` (game engine) are pure deterministic ES modules in
  `public/tools/`, shared by the browser and the Node test runner.
- Output validation: hand-written validators in `server/validate.js` (plus the JSON
  schema given to the CLI).
- Tests: `node --test`.
- Persistence: the project is autosaved to `localStorage`; export/import as JSON.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| r1 `story` | artifact language | the story text pasted by the user | `public/app.js` (`state.story`) |
| r2 `mapTemplates` | artifact spatial* | built-in grid map templates (regions as rectangles on a 16×10 grid) | `public/data/templates.js` |
| r3 `characters` | artifact record* | `{id,name,description,persona,trait,emoji,color,isPlayer}` | `state.characters` |
| r4 `map` | artifact spatial | the chosen template (deep copy) | `state.map` |
| r5 `regionLabels` | label language* | one name per region of `map` | `state.regionLabels` |
| r6 `objects` | artifact record* | `{id,name,description,emoji,region,affordances[],owner,state}` | `state.objects` |
| r7 `placement` | artifact spatial | `{entityId: {x,y}}` grid positions for characters and objects | `state.placement` |
| r8 `characterRequest` | instruction language | the user's request for one character | `state.p2.request` |
| r9 `characterProfile` | artifact language | generated persona/backstory text | `state.p2.profile` |
| r10 `traitOptions` | label language* | generated candidate trait labels | `state.p2.traits` |
| r11 `traitChoice` | selection language | the chosen trait | `state.p2.choice` |
| r12 `events` | artifact record* | story events `{id,summary,actor,location,objects}` | `state.events` |
| r13 `scripts` | artifact record* | `{id,title,trigger:{verb,target},requires[],effects[],npc,region}` | `state.scripts` |
| r14 `gameSpec` | artifact record | the composed, self-contained game definition | `state.gameSpec` |
| r15 `gameState` | artifact record | `{turn,positions,inventory,flags,fired,log,ended}` | `play.gameState` |
| r16 `view` | artifact visual | canvas rendering of the world + overlays (versions 1–3) | `#play-canvas` |
| r17 `suggestions` | artifact record* | model-suggested actions `{verb,target,label}` | `play.suggestions` |
| r18 `action` | instruction record | the player's action `{verb,target}` | `play.action` |
| r19 `rule` | artifact record | the script/built-in rule the engine matched | `play.rule` |
| r20 `storybook` | artifact visual | end-of-game storybook image (downloadable PNG) | `#storybook-canvas` |
| r21 `utterance` | instruction language | free-form text the player says to a character | `play.utterance` |
| r22 `reply` | artifact language | the character's in-character reply | `play.reply` |
| r23 `verdict` | evaluation categorical | `matched | unscripted | invalid` | `play.verdict` |
| r24 `narration` | artifact language | model-improvised narration for unscripted/invalid actions | `play.narration` |

## Transformations

| process | step | actor op | implementation | file |
| --- | --- | --- | --- | --- |
| 1 World | r1+r2* → r3* | model extract | `extractCharacters` | `server/operations.js` |
| 1 | → r4 | model select | `selectTemplate` | `server/operations.js` |
| 1 | → r5* | model assign | `assignRegionLabels` | `server/operations.js` |
| 1 | r5_1 → r5_2 | human modify | region name inputs + on-map labels | `public/views/world.js` |
| 1 | → r6* | model generate ~ | `generateObjects` | `server/operations.js` |
| 1 | → r7 | tool_1 execute | `layoutWorld()` | `public/tools/layout.js` |
| 1 | r6_1 → r6_2 | model assign | `assignAffordances` | `server/operations.js` |
| 1 | r7_1 → r7_2, r6_2 → r6_3 | human modify | drag on map; object editor | `public/views/world.js` |
| 1 | r3_1 → r3_2 | human modify | character table editor | `public/views/world.js` |
| 2 Characters | → r8 | human specify | request field | `public/views/characters.js` |
| 2 | → r9 | model generate ~ | `generateProfile` | `server/operations.js` |
| 2 | r9_1 → r9_2 | human modify | editable profile textarea | `public/views/characters.js` |
| 2 | → r10* | model generate ~ | `generateTraits` | `server/operations.js` |
| 2 | → r11 | human select | trait chips | `public/views/characters.js` |
| 2 | r3_2 → r3_3 | human modify | "Apply to character" form | `public/views/characters.js` |
| 3 Scripts | → r12* | model extract | `extractEvents` | `server/operations.js` |
| 3 | → r13* | model compose | `composeScripts` | `server/operations.js` |
| 3 | r13_1 → r13_2 | model assign | `assignScripts` (npc + region) | `server/operations.js` |
| 3 | r13_2 → r13_3 | human modify | script editor | `public/views/scripts.js` |
| 3 | → r14 | tool_2 compose | `composeGame()` | `public/tools/engine.js` |
| 4 Play | → r15+r16 | tool_2 execute | `startGame()` + `render()` | `public/tools/engine.js`, `public/tools/render.js` |
| 4 | → r17* | model generate ~ | `suggestActions` | `server/operations.js` |
| 4 | → r18 | human specify | suggestion buttons / verb+target menus | `public/views/play.js` |
| 4 | → r19 | tool_2 select | `selectRule()` | `public/tools/engine.js` |
| 4 | → r15+r16 (loop) | tool_2 execute | `applyRule()` + `render()` | `public/tools/engine.js` |
| 4 | → r20 | tool_2 execute | `renderStorybook()` ("End story") | `public/tools/render.js` |
| 5 Talk | → r21 | human specify | "Say" field | `public/views/play.js` |
| 5 | → r22 | model generate ~ | `characterReply` | `server/operations.js` |
| 5 | → r16_2 | tool_2 execute | `render()` with speech bubble | `public/tools/render.js` |
| 6 Improvise | r18 → r23 | tool_2 evaluate | `evaluateAction()` | `public/tools/engine.js` |
| 6 | → r24 | model generate ~ | `improviseNarration` | `server/operations.js` |
| 6 | → r16_3 | tool_2 execute | `render()` with narration overlay | `public/tools/render.js` |

Process 4/6 branch: every action r18 is first evaluated (process 6, tool_2 evaluate).
`matched` → process 4 continues (select + execute). `unscripted`/`invalid` → process 6
(model improvises, state unchanged, only the view changes).

## Images

None in the design.

## Open choices and defaults taken

- Model provider: local Claude Code CLI behind `callModel()` (required by the experiment).
- Persistence: localStorage + JSON export/import.
- Layout: four tabs (World, Characters, Scripts, Play) in the order of the processes.
- No steps were added to the design.
