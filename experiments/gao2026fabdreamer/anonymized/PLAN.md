# PLAN — System X

The design has 11 processes and no goal, descriptions, representation notes, references, or images.
Everything below about *what* the identifiers contain is inferred from the structure (roles, media, actors, connections)
and is recorded as a decision (see NOTES.md). Per the run instructions, this plan was not confirmed with a person;
the recommended defaults were taken.

## Interpretation

The structure reads as a **concept-to-fabrication pipeline for a physical object built from parts**:
text → concept images → chosen concept (visual) → structured design spec (record) → parts decomposition →
parts grounded in the image (spatial selections) → 3D parts (spatial) → assembled 3D model (spatial, rendered
visual, directly editable) → checks against fabrication constraints with suggested fixes → export (code + drawings).

Actors:

| Actor | Role in the app | Realisation |
| --- | --- | --- |
| model_1 | vision-language "design analyst": specs, part lists, grounding queries, critiques, judgements | `claude -p`, JSON schema output |
| model_2 | "image generator/editor": all visual generation & editing | `claude -p` producing **SVG** (no raster image model is available) |
| model_3 | "grounding model": text query + image → regions | `claude -p` with SVG source + query, returns boxes |
| model_4 | "fabrication advisor": explains check results, turns a suggestion into edit ops | `claude -p`, JSON schema output |
| tool_1 | deterministic geometry/image utilities (crop, normalise, bbox, box→3D part, checks on boxes, exporters) | TypeScript in `src/shared/tools1.ts` + DOM helpers in `src/web/svgdom.ts` |
| tool_2 | assembly composer + 3D renderer | `src/shared/tools2.ts` + three.js view |
| tool_3 | fabrication checker + edit-op executor | `src/shared/tools3.ts` |

All model calls go through one function `callModel()` in `server/provider.ts` (swap point).

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| r1 | instruction language | text prompt describing the object to design | `src/web/store.ts` (`conceptPrompt`) |
| r2 | artifact visual* | 3 candidate concept images (SVG, front orthographic view, 512×512) | `store.conceptCandidates` |
| r3 | artifact visual | the chosen concept image; versions kept (r3_1, r3_2…) | `store.concept` (`versions[]`) |
| r4 | instruction language | edit instruction for the concept image | `ConceptPanel` input |
| r5 | artifact record | design spec `{name, summary, category, dimensions{w,h,d mm}, materials[], parts[{name,description,material,count}], style}` | `store.spec` |
| r6 | instruction language | feedback on the spec | `SpecPanel` input |
| r7 | instruction record | selection from the spec: `{partNames[], dimensions}` — which parts to build | `store.partSelection` |
| r8 | artifact record* | detailed parts `{id,name,shape:box|cylinder,material,size{w,h,d},count,attachTo,notes}` | `store.parts` |
| r9 | artifact language | assembly notes (how parts connect) | `store.assemblyNotes` |
| r10 | artifact visual | normalised reference image (r3 fit to 512×512, white background) | `store.reference` |
| r11 | artifact spatial* | 3D parts `{id,name,shape,size,position,rotation,color,profileSvg?}` (mm, y-up) | `store.parts3d` (rounds kept) |
| r12 | instruction record* | grounding queries `{partId, query}` | `store.groundingQueries` |
| r13 | selection spatial* | 2D boxes in r10 `{partId, x,y,w,h, confidence}` | `store.groundings` |
| r14 | instruction language | critique/edit instruction for the reference image (with `ok` flag) | `store.refineRounds[].critique` |
| r15 | evaluation record* | box checks `{partId, inBounds, areaOk, maxOverlap, aspectOk, pass, issues[]}` | `store.boxChecks` (v1,v2) |
| r16 | selection spatial* | regrounded boxes | `store.regroundings` |
| r17 | artifact visual* | isolated side-view image per part (SVG) | `store.sideViews` |
| r18 | selection spatial* | silhouette bbox extracted from each r17 | `store.sideBoxes` |
| r19 | artifact spatial* | refined 3D parts (front box from r16, depth from r18, profile = r17) | `store.refinedParts` |
| r20 | instruction language | prompt for a single new part | `PartStudio` |
| r21 | artifact visual* | candidate part images | `PartStudio` state |
| r22 | artifact visual | chosen part image | 〃 |
| r23 | evaluation categorical | `usable | needs_cleanup | unusable` | 〃 |
| r24 | artifact visual | clean isolated part image | 〃 |
| r25 | selection spatial | bbox of r24 silhouette | 〃 |
| r26 | artifact spatial | 3D part extruded from r24 | 〃 |
| r27 | artifact spatial | assembly `{parts: Part3D[]}`; versions kept | `store.assembly` (`history[]`) |
| r28 | artifact visual | three.js rendering of r27 | `AssemblyView` |
| r29 | selection categorical | chosen part id (to regenerate from image) | `RegeneratePanel` |
| r30 | artifact visual | crop of r3 around that part | 〃 |
| r31 | artifact visual | regenerated clean part image | 〃 |
| r32 | artifact spatial | new 3D part from r31 | 〃 |
| r33 | selection categorical | chosen part id (anchor for a language edit) | `LanguageEditPanel` |
| r34 | instruction language | edit request | 〃 |
| r35 | instruction record* | new/changed part specs `{action:add|replace, name, shape, size, placement query, replacesId?}` | 〃 |
| r36 | selection spatial* | 3D placement boxes from model_3 | 〃 |
| r37 | artifact spatial* | resulting 3D parts | 〃 |
| r38 | instruction record | fabrication constraints `{material, sheetThickness, maxW,maxH,maxD, minThickness, method}` | `store.constraints` |
| r39 | evaluation record* | checks `{id, kind, severity, partIds, message, value}` | `FabricationPanel` |
| r40 | evaluation language | advisor explanation `{summary, suggestions[{id,title,rationale}]}` | 〃 |
| r41 | instruction record | selected suggestion | 〃 |
| r42 | instruction record | edit ops `{ops:[{op:move|resize|delete|add, partId, …}]}` | 〃 |
| r43 | artifact formal* | OpenSCAD per part + assembly | `ExportPanel` |
| r44 | artifact visual* | SVG dimensioned drawings per part | 〃 |
| r45 | instruction categorical | export format: `openscad | drawings | full` | 〃 |
| r46 | artifact record | export bundle `{format, createdAt, bom[], files[{name,mime,content}]}` | 〃 |

## Transformations (process order)

| P | step | actor op | implementation |
| --- | --- | --- | --- |
| 1 | r1→r2* | model_2 generate~ | `POST /api/model/generateConcepts` |
| 1 | r2*→r3 | human select | click a candidate in `ConceptPanel` |
| 2 | r3→+r4 | human specify | edit textarea |
| 2 | r3+r4→r3_2 | model_2 modify~ | `/api/model/editImage` (versions kept, revert) |
| 3 | r3→+r5 | model_1 generate~ | `/api/model/generateSpec` |
| 3 | +r6 | human specify | feedback textarea |
| 3 | r5+r6→r5 | model_1 modify~ | `/api/model/reviseSpec` (loop: "Revise again"; versions kept) |
| 4 | r3+r5→r7 | human select | checkboxes of spec parts |
| 4 | →r8* | model_1 extract | `/api/model/extractParts` |
| 4 | →r9 | model_1 extract | `/api/model/extractAssemblyNotes` |
| 4 | →r10+r11* | tool_1 modify | `normalizeReference()` + `initialParts()` |
| 4 | →r12* | model_1 extract | `/api/model/groundingQueries` |
| 4 | →r13* | model_3 extract | `/api/model/ground` |
| 4 | →r11_2* | tool_1 translate | `boxesToParts()` |
| 4 | →r14 | model_1 generate~ | `/api/model/critiqueParts` |
| 4 | →back | model_2 modify~ | `/api/model/editImage` on r10; loop until critique ok or 2 rounds |
| 5 | →r15* | tool_1 evaluate | `checkBoxes()` |
| 5 | →r16* | model_3 modify | `/api/model/reground` (failing boxes only) |
| 5 | →r15_2* | tool_1 evaluate | `checkBoxes()` |
| 5 | →r17* | model_2 generate~ | `/api/model/sideViews` |
| 5 | →r18* | tool_1 extract | `svgSilhouetteBox()` (DOM getBBox) |
| 5 | →r19* | tool_1 translate | `refinePartsFromViews()` |
| 6 | r20→r21* | model_2 generate~ | `/api/model/generatePartImages` |
| 6 | →r22 | human select | click candidate |
| 6 | →r23 | model_1 evaluate | `/api/model/judgePartImage` |
| 6 | →r24 | model_2 generate~ | `/api/model/cleanPartImage` |
| 6 | →r25 | tool_1 extract | `svgSilhouetteBox()` |
| 6 | →r26 | tool_1 translate | `imageToPart()` |
| 7 | r11*→r27 | tool_2 compose | `composeAssembly()` |
| 7 | →r28 | tool_2 translate | three.js `AssemblyView` |
| 7 | →r27_2 | human modify | drag gizmo / numeric fields / add-replace-delete parts |
| 7 | →r28 | tool_2 translate | re-render (loop) |
| 8 | →r29 | human select | part dropdown |
| 8 | →r30 | tool_1 extract | `cropSvg()` |
| 8 | →r31 | model_2 modify~ | `/api/model/regeneratePart` |
| 8 | →r32 | tool_1 translate | `imageToPart()` |
| 9 | →r33,r34 | human select, specify | dropdown + textarea |
| 9 | →r35* | model_1 extract | `/api/model/planPartEdit` |
| 9 | →r36* | model_3 extract | `/api/model/place3d` |
| 9 | →r37* | tool_1 translate | `placementsToParts()` |
| 10 | →r39* | tool_3 evaluate | `runFabChecks()` |
| 10 | →r40 | model_4 generate~ | `/api/model/adviseFab` |
| 10 | →r41 | human select | click a suggestion |
| 10 | →r42 | model_4 translate | `/api/model/suggestionToOps` |
| 10 | →r27 | tool_3 execute | `applyOps()` (loop: re-check) |
| 11 | →r43*+r44* | tool_1 translate | `toOpenScad()`, `toDrawingSvg()` |
| 11 | →r45 | human select | format buttons |
| 11 | →r46 | tool_1 compose | `composeExport()` + download |

## Images
The design lists none.

## Open choices (defaults taken)

| choice | default |
| --- | --- |
| stack | Vite + React + TypeScript frontend, Express (tsx) backend, one package |
| model provider | `claude -p --output-format json --json-schema … --tools ""`, CLAUDECODE removed, behind `callModel()` |
| image generation | SVG produced by the LLM (only model available) |
| 3D | three.js; parts are boxes/cylinders or extruded SVG silhouettes |
| state/persistence | zustand store persisted to localStorage |
| layout | left: step navigation (processes as tabs/sections); center: main artifact view; right: inspector |
| connecting outputs r19, r26, r32, r37 to the assembly | via P7's `[human modify]` on r27 ("Add/replace in assembly" buttons) — no new step |
| tests | vitest for deterministic tools |
