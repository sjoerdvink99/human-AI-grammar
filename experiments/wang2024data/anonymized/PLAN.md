# PLAN — System X

The design (`design.json`) has no goal, description, representation texts, references or images.
Everything below about *what* each identifier contains is inferred from roles, media, operations and
how the four processes connect. Defaults were taken without waiting for confirmation (per the
experiment instructions).

## Inferred reading

A visualization authoring tool for tabular data:

- **P1** load a table → extract field metadata → the user fills encoding shelves → compile to a chart spec → render.
- **P2** the user declares *new concepts* (fields that are not in the table), drops them on the shelves; the system
  composes an *example table* that the user fills in; a deterministic program-by-example synthesizer (tool_2)
  produces reshaping programs; each is executed into a candidate table and rendered into a candidate chart;
  the user picks one, which becomes the new working table, and the new concepts are assigned as fields.
- **P3** the user describes a *derived concept* in language (name + description + source fields); the system composes
  several code prompts, the model generates code candidates, a tool runs them to evaluate them (drop failures,
  show output previews), the user picks one, it is executed to add a column, and the user charts it.
- **P4** the user edits the derived concept's description and regenerates, replacing the column.

## Representations

| id | type | contents | file |
|---|---|---|---|
| r1 `table` | artifact tabular | `{name, columns[], rows[]}`; versions kept in `tableHistory` | `src/types.ts`, `src/state.ts` |
| r2 `fields` | artifact record* | `FieldMeta {name, type: quantitative/nominal/temporal, source: original/reshaped/derived, derivation?}` | `src/types.ts` |
| r3 `encoding` | instruction record | `{mark, channels: {x,y,color,size,column}}` (field names) | `src/types.ts` |
| r4 `vlSpec` | artifact record | Vega-Lite spec (without data values) | `src/tools/translate.ts` |
| r5 `chart` | artifact visual | rendered Vega-Lite chart | `src/components/Chart.tsx` |
| r6 `concepts` | artifact record* | `{name, kind:'reshape'}` declared by user, not in table | `src/types.ts` |
| r7 `exampleTable` | instruction tabular | columns = fields on shelves; rows editable by the user | `src/tools/composeExample.ts` |
| r8 `programs` | artifact formal* | reshaping programs (`fold(...)`, `pivot(...)`) as code text + AST | `src/tools/synthesize.ts` |
| r9 `candidateTables` | artifact tabular* | output of each program | `src/tools/reshape.ts` |
| r10 `candidateCharts` | artifact visual* | chart per candidate table | `src/components/FormulatePanel.tsx` |
| r11 `deriveRequest` | instruction record | `{name, description, sourceFields[]}` | `src/types.ts` |
| r12 `prompts` | instruction formal* | code-skeleton prompts (JS function stub + docstring + sample rows), 3 variants | `src/tools/composePrompts.ts` |
| r13 `generatedCode` | artifact formal* | JS `derive(row)` functions from the model | `server/model.ts`, `server/index.ts` |
| r14 `validCode` | artifact formal* | candidates that ran without error, deduplicated by output | `server/sandbox.ts` |
| r15 `previews` | artifact tabular* | source fields + new column, first rows, per candidate | `server/sandbox.ts` |
| r16 `chosenCode` | artifact formal | the selected candidate | `src/components/DerivePanel.tsx` |

## Transformations

| process | step | function / component | file |
|---|---|---|---|
| P1 | [tool_1 extract] | `extractFields` | `src/tools/extract.ts` |
| P1 | [human specify] r3 | `EncodingShelf` (drag chips / menus) | `src/components/EncodingShelf.tsx` |
| P1 | [tool_1 translate] | `translateToSpec` | `src/tools/translate.ts` |
| P1 | [tool_1 execute] | `Chart` (vega-embed) | `src/components/Chart.tsx` |
| P2 | [human specify] r6 | "New concept" form | `src/components/FieldPanel.tsx` |
| P2 | [human specify] r3_2 | `EncodingShelf` with concept chips | `src/components/EncodingShelf.tsx` |
| P2 | [tool_1 compose] r7 | `composeExampleTable` | `src/tools/composeExample.ts` |
| P2 | [human modify] r7 | editable grid | `src/components/FormulatePanel.tsx` |
| P2 | [tool_2 execute] r8 | `synthesizePrograms` | `src/tools/synthesize.ts` |
| P2 | [tool_1 execute] r9 | `runProgram` | `src/tools/reshape.ts` |
| P2 | [tool_1 translate] r4_2 | `translateToSpec` | `src/tools/translate.ts` |
| P2 | [tool_1 execute] r10 | `Chart` per candidate | `src/components/FormulatePanel.tsx` |
| P2 | [human select] | "Use this" on a candidate | `src/components/FormulatePanel.tsx` |
| P2 | [tool_1 assign] r2_2 | `assignFields` | `src/tools/extract.ts` |
| P3 | [human specify] r11 | derive form | `src/components/DerivePanel.tsx` |
| P3 | [tool_1 compose] r12 | `composePrompts` | `src/tools/composePrompts.ts` |
| P3 | [model generate]~ r13 | `POST /api/generate` → `callModel` (Claude CLI) | `server/model.ts` |
| P3 | [tool_1 evaluate] r14+r15 | `POST /api/evaluate` → `evaluateCandidates` (node:vm) | `server/sandbox.ts` |
| P3 | [human select] r16 | candidate cards | `src/components/DerivePanel.tsx` |
| P3 | [tool_1 execute] r1_3,r2_3 | `POST /api/execute` → `applyDerivation` | `server/sandbox.ts` |
| P3 | [human specify] r3_3 → translate → execute | same as P1 | |
| P4 | [human modify] r11_2 | "Edit" on a derived field reopens the form prefilled | `src/components/DerivePanel.tsx` |
| P4 | rest | same functions as P3, executing replaces the column | |

## Open choices and defaults taken

- Stack: Vite + React + TypeScript front end, Express (TypeScript via tsx) back end. No database; state in memory.
- Charts: Vega-Lite via vega-embed.
- Model provider: Claude Code CLI (`claude -p --output-format json --tools ""`, CLAUDECODE removed), behind `callModel()`.
- Number of prompt variants / code candidates: 3, generated in parallel.
- Generated code runs server-side in `node:vm` with a timeout.
- Synthesizer (tool_2): enumerative search over `fold` (wide→long) and `pivot` (long→wide) programs, checked against the example table.
- Layout: left = data loading + fields/concepts; centre = encoding shelves + chart; right = formulate/derive panel; bottom = data table.
- Sample datasets bundled (invented numbers); CSV/JSON upload supported.
