# PLAN — System X

The design has no goal, descriptions, representation notes, references or images. Only the six
expressions are given. The plan below infers a domain that fits the structure and takes the
recommended default for every open choice (per the experiment instructions, no confirmation was awaited).

## Inferred domain

A **code-backed drawing editor**: the user describes a picture in words, a model writes a small
declarative drawing program (formal), and deterministic code translates the program into a scene
tree (graph), a rendered SVG picture (visual) and a parameter table (record). The user then edits
the picture through the tree/canvas (selection), a property inspector (structured edit), the
parameter table (structured edit), a scoped natural-language edit of one element (model edits the
extracted snippet), or a global natural-language edit (model regenerates the program).

The program language ("Shape DSL", defined in `shared/dsl.ts`):

```
canvas 400 300 background="#f4f1ea"
param roof_color = "#a0522d"
param house_w = 160 [60, 300]
group house x=120 y=100 {
  rect walls x=0 y=60 w=house_w h=100 fill="#e8d8b0" stroke="#333"
  polygon roof points="0,60 {house_w/2},0 {house_w},60" fill=roof_color
}
circle sun cx=340 cy=50 r=24 fill="gold"
```

## Representations

| id | role medium | contents | code |
| --- | --- | --- | --- |
| r1 | instruction language | initial description of the picture | `client/src/App.tsx` (`r1` state, start screen) |
| r2 | instruction record | model request `{task, instruction, current_code?, dsl_spec}` (r2_1 from r1, r2_2 from r16 + r3) | `server/compose.ts` `composeGenerateRequest` |
| r3 | artifact formal | the Shape DSL program (versions kept in history) | `App.tsx` `r3` state, `CodeView.tsx` |
| r4 | artifact graph | scene tree: nodes with id, kind, name, attrs, line span, children | `shared/dsl.ts` `SceneNode`, `TreeView.tsx` |
| r5 | artifact visual | rendered SVG | `shared/render.ts`, `CanvasView.tsx` |
| r6 | artifact record | parameter table: name, type, value, min, max, line | `shared/dsl.ts` `ParamRecord`, `ParamsTable.tsx` |
| r7 | selection record | selected scene element `{nodeId, kind, name, startLine, endLine}` | `App.tsx` `r7` |
| r8 | selection visual | highlight overlay on canvas + highlighted lines / tree row | `CanvasView.tsx`, `CodeView.tsx` |
| r9 | instruction record | attribute edit `{nodeId, attr, value}` | `Inspector.tsx` |
| r10 | selection record | selected parameter `{name}` | `App.tsx` `r10` |
| r11 | instruction record | parameter edit `{name, value}` | `ParamsTable.tsx` |
| r12 | selection record | element targeted for NL edit `{nodeId, startLine, endLine}` | `App.tsx` `r12` |
| r13 | instruction language | NL instruction for the selected element | `ScopedEdit.tsx` |
| r14 | artifact formal | extracted snippet of the element (r14_1), model-edited snippet (r14_2) | `shared/edit.ts` `extractSnippet`, server |
| r15 | instruction record | `{task:"modify_snippet", instruction, snippet, context_code, params}` | `server/compose.ts` `composeSnippetRequest` |
| r16 | instruction language | NL instruction for the whole drawing | `GlobalEdit` in `App.tsx` |

## Transformations

| process | step | implementation |
| --- | --- | --- |
| 1 | tool compose r1→r2_1 | `server/compose.ts composeGenerateRequest` |
| 1 | model generate~ r2→r3 | `server/model.ts callModel` via `POST /api/generate`, validated by parser, one retry with error |
| 1,3–6 | tool translate r3→r4+r5+r6 | `shared/dsl.ts parseProgram` + `shared/render.ts renderSvg` (client `useMemo`) |
| 2 | human select →r7 | click on canvas element or tree row |
| 2 | tool translate r7→r8 | `CanvasView` overlay from element bbox, `CodeView` line highlight |
| 3 | human specify →r9 | inspector field edit (Enter/blur) |
| 3 | tool modify r9→r3_2 | `shared/edit.ts setAttribute` |
| 4 | human select →r10 | click row in parameter table |
| 4 | human specify →r11 | slider / input on that row |
| 4 | tool modify r11→r3_2 | `shared/edit.ts setParam` |
| 5 | human select →r12 | "Edit with AI" target = currently selected element (pinned when request starts) |
| 5 | human specify →r13 | scoped instruction text box |
| 5 | tool extract r3+r12→r14_1 | `shared/edit.ts extractSnippet` |
| 5 | tool compose →r15 | `server/compose.ts composeSnippetRequest` |
| 5 | model modify~ r15→r14_2 | `callModel` via `POST /api/modify-snippet`, validated |
| 5 | tool modify r14_2→r3_2 | `shared/edit.ts spliceSnippet` |
| 6 | human specify →r16 | global instruction box |
| 6 | tool compose r16+r3→r2_2 | `composeGenerateRequest` with current code |
| 6 | model generate~ r2_2→r3_2 | `POST /api/generate` |

## Choices (defaults taken)

- Stack: Vite + React + TypeScript client, Express (tsx) server, shared TS parser; vitest for tests.
- Model provider: local `claude -p --output-format json` (CLAUDECODE removed) behind `server/model.ts callModel`.
- Persistence: none beyond browser `localStorage` of the current program and version history.
- Layout: left = tree + parameters, centre = canvas, right = inspector + scoped AI edit, bottom = code; top bar = global edit.
- Version history: every r3 change is appended to an in-memory list (shown as a count); no revert step since the design has none.
