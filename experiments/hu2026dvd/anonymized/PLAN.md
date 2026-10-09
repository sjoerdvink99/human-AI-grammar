# PLAN — System X

The design has no goal, no descriptions, no representation descriptions, no references and no images.
Everything below about *meaning* is inferred from the structure of the eight expressions alone.
Per the experiment instructions, I take my own recommended defaults and continue without waiting.

## Interpretation (inferred)

The structure reads as a **pictorial infographic studio**:

- Process 1: a model turns a brief (r1) plus style references (r2*) and source documents (r3*) into a
  collection of structured *visual elements* (r4*). A tool composes them into a scene spec (r5), a renderer
  executes it into a scene image (r6), and a tool composes the scene into a gallery of snapshots (r7*).
- Process 2: provenance — selecting an element retrieves the passage in the source document (r10) and the
  linked source images (r11*) from the user-provided image collection (r8*).
- Process 3: critique → edit loop — the human writes an evaluation note (r12), edits elements (r4_2),
  the scene is recomposed and re-rendered (r5_2, r6_2) and snapshotted into the gallery; earlier rounds stay in r7*.
- Process 4: illustrate one element — select it, a tool composes an illustration request (r14), a second
  model generates a detailed illustration (r15).
- Process 5: data → chart — the human picks a chart type (r17) for an uploaded table (r16); a tool renders the chart (r18).
- Process 6: pictorial chart, automatic placement — the human picks a region of the scene (r19) and clicks
  points on the object (r20); a vision model extracts the object outline (r21); a tool cuts it out (r22) and
  composes it onto the chart automatically (r23).
- Process 7: same, but the human places the cutout on the chart (r28) before composition (r29).
- Process 8: the human picks a snapshot from the gallery (r30) and writes a review comment (r31).

## Stack (empty repo → minimal stack)

- Vite + React + TypeScript front end (`src/`), Express + TypeScript back end (`server/`) run with `tsx`.
- One model function `callModel()` in `server/model.ts` spawns `claude -p --output-format json --json-schema …`
  with `CLAUDECODE` removed from the environment; swap providers there.
- Deterministic tools in `shared/` (pure TS, unit-tested with Vitest) and canvas-based tools in `src/tools/`.
- State in a single React reducer (`src/state.ts`), persisted to `localStorage`.

## Representations

| id | type | contents (inferred) | file |
| --- | --- | --- | --- |
| brief (r1) | instruction language | what the infographic should communicate | `src/state.ts`, `SourcesPanel.tsx` |
| styleRefs (r2*) | artifact language* | style reference descriptions | `SourcesPanel.tsx` |
| documents (r3*) | artifact language* | source documents (title + text) | `SourcesPanel.tsx` |
| elements (r4*) | artifact record* | `VisualElement` {id,name,kind,description,x,y,w,h,color,svg,sources[{doc,quote}],imageRefs[]} | `shared/types.ts` |
| sceneSpec (r5) | instruction record | `SceneSpec` {width,height,background,layers[]} | `shared/compose.ts` |
| scene (r6) | artifact visual | rendered SVG string (+ rasterized PNG when needed) | `shared/render.ts` |
| snapshots (r7*) | artifact visual* | gallery of rendered scenes with round number | `shared/compose.ts` |
| sourceImages (r8*) | artifact visual* | user-uploaded images, data URLs | `SourcesPanel.tsx` |
| selectedElement (r9) | selection record | id of the chosen element | `state.ts` |
| sourcePassage (r10) | selection language | doc + highlighted span | `shared/provenance.ts` |
| linkedImages (r11*) | selection visual* | images referenced by the element | `shared/provenance.ts` |
| critique (r12) | evaluation language | note on the current scene | `ScenePanel.tsx` |
| illustrationTarget (r13) | selection record | element chosen for illustration | `IllustratePanel.tsx` |
| illustrationRequest (r14) | instruction record | {subject,description,style,palette,aspect} | `shared/compose.ts` |
| illustration (r15) | artifact visual | model-generated SVG | `IllustratePanel.tsx` |
| table (r16) | artifact tabular | parsed CSV rows/columns | `shared/table.ts` |
| chartType (r17) | instruction categorical | bar / column / line / pie / scatter | `shared/chart.ts` |
| chart (r18) | artifact visual | rendered SVG chart with plot-area metadata | `shared/chart.ts` |
| regionCrop (r19 / r24) | selection visual | rectangle crop of the scene (PNG) | `CutoutPanel.tsx` |
| clickPoints (r20 / r25) | selection spatial | foreground/background points inside the crop | `CutoutPanel.tsx` |
| objectMask (r21 / r26) | selection spatial | polygon outline in crop coordinates | `server/routes.ts` (model_3) |
| cutout (r22 / r27) | artifact visual | masked PNG with transparent background | `src/tools/cutout.ts` |
| placement (r28) | selection spatial | x,y,scale chosen by dragging on the chart | `CutoutPanel.tsx` |
| pictorialChart (r23 / r29) | artifact visual | chart SVG with embedded cutout | `shared/pictorial.ts` |
| reviewedSnapshot (r30) | artifact visual | the snapshot chosen from the gallery | `GalleryPanel.tsx` |
| review (r31) | evaluation language | comment on that snapshot | `GalleryPanel.tsx` |

## Transformations

| process | step | implementation | file |
| --- | --- | --- | --- |
| P1 | [model_1 generate]~ | `generateElements` → POST `/api/elements` | `server/routes.ts` |
| P1 | [tool_1 compose] | `composeSceneSpec(elements)` | `shared/compose.ts` |
| P1 | [tool_2 execute] | `renderScene(spec)` | `shared/render.ts` |
| P1 | [tool_7 compose] | `addSnapshot(snapshots, scene)` | `shared/compose.ts` |
| P2 | [human select] | click element in scene or list | `ScenePanel.tsx` |
| P2 | [tool_3 select] | `retrieveProvenance(element, documents, images)` | `shared/provenance.ts` |
| P3 | [human evaluate] | critique text box under scene | `ScenePanel.tsx` |
| P3 | [human modify] | element inspector form + drag on scene | `ElementEditor.tsx` |
| P3 | tool_1 / tool_2 / tool_7 | "Re-render & snapshot" button reuses P1 tools | `App.tsx` |
| P4 | [human select] | pick element in Illustrate tab | `IllustratePanel.tsx` |
| P4 | [tool_1 compose] | `composeIllustrationRequest(element)` | `shared/compose.ts` |
| P4 | [model_2 generate]~ | POST `/api/illustrate` | `server/routes.ts` |
| P5 | [human specify] | chart-type buttons | `ChartPanel.tsx` |
| P5 | [tool_4 translate] | `renderChart(table, type)` | `shared/chart.ts` |
| P6/P7 | [human select] ×2 | drag rectangle, then click points | `CutoutPanel.tsx` |
| P6/P7 | [model_3 extract] | POST `/api/extract` (vision: crop PNG read by Claude) | `server/routes.ts` |
| P6/P7 | [tool_5 modify] | `applyMask(cropPng, polygon)` | `src/tools/cutout.ts` |
| P7 | [human select] | drag/scale cutout on chart | `CutoutPanel.tsx` |
| P6/P7 | [tool_6 compose] | `composePictorial(chart, cutout, placement?)` | `shared/pictorial.ts` |
| P8 | [human select] | click snapshot in gallery | `GalleryPanel.tsx` |
| P8 | [human evaluate] | comment box | `GalleryPanel.tsx` |

## Open choices and defaults taken

- Model provider: local Claude Code CLI behind `callModel()`; structured output via `--json-schema`.
- model_2 (image generation): no image model available → Claude generates SVG illustrations; sanitized.
- model_3 (extraction): Claude with the `Read` tool only, reading the crop PNG from a temp dir, returns a polygon.
- Persistence: browser `localStorage`; no database.
- Layout: left sources column, centre tabbed workspace (Scene / Illustrate / Chart / Pictorial / Gallery), right inspector.
- Processes 6 and 7 are one panel with an "Auto place" vs "Place manually" mode toggle.
