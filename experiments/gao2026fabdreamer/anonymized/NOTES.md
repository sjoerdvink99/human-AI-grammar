# NOTES — decisions the design did not determine

The design (`design.json`) gives 11 processes as grammar expressions and nothing else. It has no name beyond
"System X", no goal, no description of the system or of any process, no representation descriptions, no
references, and no images. Everything below was my choice. The plan is in `PLAN.md`, and the
step → code map is in `README.md`.

## 1. What the system is for (the biggest decision)

- **Domain.** I read the structure as a *concept-to-fabrication tool for physical objects made of parts*
  (furniture, products). The clues:
  - visual → record → extracted part records → spatial artifacts
  - a composed spatial artifact that is rendered to a visual and edited by hand
  - an `instruction record` checked by a tool, followed by `execute`
  - a final `formal*` + `visual*` export

  The demo prompts I used were tables and brackets.
- **Contents of every identifier.** None were given, so all were inferred (table in PLAN.md):
  - r5 is a design spec
  - r7 is a selection of spec part types plus the target overall size
  - r8 is one record per physical piece
  - r9 is assembly notes
  - r10 is a normalised reference image
  - r11, r19, r26, r32, r37 are 3D parts
  - r12 is grounding queries
  - r13, r16 are 2D boxes
  - r14 is a critique with an `ok` flag
  - r15 is box-check records
  - r17 is per-part side views
  - r18, r25 are silhouette boxes
  - r23 is `usable | needs_cleanup | unusable`
  - r27 is the assembly
  - r28 is its 3D rendering
  - r29, r33 are part ids
  - r30 is a crop
  - r35 is planned part changes
  - r36 is 3D placement boxes
  - r38 is fabrication constraints
  - r39 is fabrication checks
  - r40 is an explanation with selectable suggestions
  - r41 is the chosen suggestion
  - r42 is edit ops
  - r43 is OpenSCAD files
  - r44 is SVG drawings
  - r45 is `openscad | drawings | full`
  - r46 is an export bundle
- **Model roles.** These are inferred from which operations each model performs:
  - `model_1` is a vision-language analyst.
  - `model_2` is an image generator/editor.
  - `model_3` is a grounding model: it turns text into regions (2D boxes in P4/P5, 3D boxes in P9).
  - `model_4` is a fabrication advisor.
  - `tool_1` is geometry/image utilities and exporters.
  - `tool_2` is the assembly composer and renderer.
  - `tool_3` is the fabrication checker and op executor.
- **Process triggers.** None were specified. Human steps are buttons and selections. Chains with no human
  step in them run automatically once started:
  - P4 after "Build parts"
  - P5 after "Refine parts"
  - P6 after picking an image
  - P8, P9, P10 after their buttons
- **P4 loop end condition.** The loop closes on a model step, so it is checked in code. It stops when
  `model_1`'s critique says `ok` or after 2 automatic rounds. "Run another round" continues by hand,
  earlier rounds stay visible, and "Use this round" restores one.
- **What `model_2 modify` changes in the P4 loop.** It edits the reference image r10 using r14. The loop then
  returns to r11_1 (the initial parts) and grounding runs again. The critique prompt is restricted to edits
  that keep a straight front view (added after a test run asked for a three-quarter view).
- **P3 loop.** Each revision is a new r5 version, so all rounds can be compared ("r5 round n" chips).
- **P10 loop.** After `tool_3 execute`, the checks and advice run again automatically (back to r27 + r38).
  The next round is gated by the human picking a suggestion.
- **P7 loop.** Every direct edit pushes a new r27 version and re-renders. Undo/redo walks the versions
  (up to 50).
- **Outputs the design leaves unconnected** (r19, r26, r32, r37). I route them into the assembly through
  P7's `[human modify]` on r27 ("Assemble refined parts", "Add to assembly", "Replace … with r32",
  "Apply n part(s)"). I added no new transformation, but the wiring is my reading.
- **"Built only from the preceding state."** Each model prompt uses only the identifiers in the state
  before it. For example, P3's spec prompt sees only the image, not the original text prompt r1.
  - In P9, `model_3` sees only r35. So that r35 can carry the geometry it needs, the server fills each
    planned part's `anchor` geometry from r27 when it validates `model_1`'s output (it resolves the
    anchor id that model_1 returned).
- **The P5 → P7 connection.** I made it a choice of source ("Assemble these parts" uses r11,
  "Assemble refined parts" uses r19).

## 2. Models and prompts

- Provider: the Claude Code CLI through one function, `callModel()` in `server/provider.ts`. It runs
  `claude -p --output-format json --json-schema <schema> --system-prompt <role> --tools ""` with
  `CLAUDECODE` unset, in a temporary working directory. I read `structured_output`, and fall back to
  parsing `result`.
- Each model role has its own system prompt (`SYS` in `server/ops.ts`) and its own model setting
  (`MODEL_1..4`, default `sonnet` for speed).
- There is one prompt per operation, 18 in total (listed in `server/ops.ts`). Every output is checked with
  zod and with domain rules:
  - SVG is sanitised: no scripts, event handlers, foreignObject, or external hrefs, and it must have an
    `<svg>` root.
  - Part ids are de-duplicated.
  - Boxes and queries pointing to unknown parts are dropped.
  - Confidence is clamped to 0–1.
  - Sizes must be positive.
  - Unknown replace targets are nulled.
- A failed call or a validation error triggers one automatic retry.
- **Image generation is SVG.** No raster image model is available, so `model_2` "draws" SVG. Its prompts
  ask for:
  - flat vector style
  - a 512×512 viewBox
  - an orthographic front view (side view for r17)
  - a transparent background
  - one `<g>` per piece
  - single dark silhouettes where the image will be measured (r17, r24, r31)
- **Grounding is done by reading SVG source.** `model_3` gets the SVG code and works out coordinates.
  `model_1`'s "vision" also reads SVG source.
- Concept and part galleries hold 3 candidates, made by 3 parallel calls with different style directions.
- P5 side views run as one call per part, at most 4 at a time.

## 3. Geometry and data formats

- Units are mm, y is up, the ground is y = 0, part positions are centres, and rotation is about y only.
- Part shapes:
  - `box` and `cylinder` (w = d = diameter)
  - `profile`: an SVG silhouette extruded with three.js `SVGLoader` + `ExtrudeGeometry`, either along z
    (front profile) or along x (side profile)
- Image → 3D mapping (`boxesToParts`):
  - The union of all boxes is scaled to the selected overall width × height.
  - Depth comes from the part record.
  - Front/back placement comes from the record's `zHint`.
- Side-view refinement (`refinePartsFromViews`): depth = height × (silhouette width / silhouette height),
  and the side silhouette becomes the profile.
- Box checks (r15) have fixed thresholds:
  - inside the canvas, with a 4 px tolerance
  - area at least 0.04% and at most 90% of the canvas
  - IoU with another box at most 0.85
  - aspect ratio within 4× of what the record implies
  - confidence at least 0.3
- Fabrication checks (r39):
  - overall bounds
  - below-ground parts
  - minimum thickness
  - sheet-thickness match for sheet methods (±0.5 mm)
  - floating parts (2 mm contact tolerance)
  - intersections over 10% of the smaller part
  - stability: the volume-weighted centre of mass must lie inside the bounding rectangle of the
    ground-contact parts, with a warning within 10% of the edge
  - All of these use axis-aligned bounding boxes with the y-rotation taken into account.
- Default constraints: laser-cut sheet, birch plywood, 6 mm sheet, 3 mm minimum, 600×600×600 mm.
- Edit ops (r42): `move | resize | rotate | delete | add`. Ops that point to unknown parts are skipped and
  reported.
- Export:
  - OpenSCAD: an assembly file plus one file per part. Axes are converted to z-up. Profile parts export
    as their bounding block with a comment.
  - Drawings: SVG with front and side views and dimensions.
  - The full package adds `bom.csv` and `assembly.json`.
  - r46 downloads as one JSON bundle, or file by file.
- Silhouette extraction (r18, r25, and inside r32) runs in the browser:
  - It measures every shape with `getBBox()` plus the screen transform.
  - It ignores white backdrops, and shapes that cover the canvas unless nothing else is drawn.

## 4. Libraries and stack

- Vite, React 19 and TypeScript for the frontend, and Express run with `tsx` for the backend, in one
  package.
- zustand for state, persisted to `localStorage`.
- three.js for the 3D view (OrbitControls, TransformControls, SVGLoader).
- zod for validation.
- vitest for unit tests of the deterministic tools.
- Playwright for an optional UI walkthrough script.
- No database and no accounts. State lives in the browser, and "New design" clears it.

## 5. Layout, styling and interaction

- The top bar has numbered tabs in workflow order: Concept (P1–P2), Specification (P3), Parts (P4),
  Refine parts (P5), Assembly (P7–P9), Fabrication (P10), Export (P11). "Part studio" (P6) is a separate
  "+" tab because P6 has no connection to the other processes. A ✓ marks a finished stage.
- Each step is a card with a coloured actor badge (human purple, model blue, tool green) and the design
  identifiers it covers (e.g. `r3 + r4 → r3_2`), so the UI can be traced back to the grammar.
- Most tabs use two columns. Assembly and Fabrication use a large 3D view with a right-hand inspector.
- Selection spatial is drawn as coloured, labelled boxes over the image it refers to. Failing boxes are red,
  and boxes from before re-grounding are dashed.
- In the 3D view:
  - Click selects a part.
  - The gizmo has Move and Rotate (y only) modes.
  - Numeric fields edit size, position and rotation.
  - Parts can be duplicated and deleted.
  - Proposed parts (r32, r37) appear as translucent blue ghosts until applied.
  - In Fabrication, parts involved in failing checks glow red.
- Generative steps show a spinner with the current sub-step ("round 2: model_3 is grounding 9 parts…").
  Errors appear inline per process. Regenerate buttons are available, and human review comes before
  committing (pick a concept, apply ghosts, choose a suggestion).
- Visual style: a neutral warm-grey palette with one blue accent and the system sans-serif font. The
  OpenSCAD view has minimal syntax highlighting.

## 6. Verification

- `npm run build` (type check + Vite build) passes, and `npm test` passes 13 unit tests.
- `scripts/walkthrough.ts` ran all 18 model operations against the real CLI.
- `scripts/ui-walkthrough.ts` drove the running app through P1, P2, P3, P4, P5, P7, P8, P9, P10, P11 and P6
  in one session. Every transformation was reached, and the screenshots are in `.data/shots/`.
- Problems found and fixed along the way:
  - silhouette extraction skipped every shape, because the hidden host's `visibility: hidden` was inherited
  - P8 lost the part's width
  - the critique asked for a non-front view

## 7. Did the design remind me of a specific published system?

Not one I can name with confidence. The overall shape reminded me of a family of recent HCI and graphics
pipelines rather than of one paper. These pipelines:

- generate concept images with a diffusion model
- reason about them with a GPT-4V-style vision-language model
- ground parts with an open-vocabulary detector or segmenter (Grounding DINO / SAM style)
- lift images to 3D (image-to-3D models)
- assemble the parts, then check fabricability or physics before export

Examples in that space include generative fabrication and personal-fabrication tools such as 3DALL-E and
Style2Fab, and part-aware text/image-to-3D work. I don't know whether the design comes from any of them.

These choices came from that general background knowledge, not from the design:

- Reading `model_2` as an image generation/editing model (here it becomes SVG), `model_3` as a
  grounding/segmentation model that returns boxes, and `model_1` as a vision-language model.
- Reading P4's `tool_1 translate` from selections to spatial artifacts, and P5/P6/P8's
  image → selection → spatial chains, as "segment, then lift to 3D". My deterministic stand-in is
  silhouette bounding box + extrusion, in place of a learned image-to-3D model.
- Reading `tool_3 evaluate/execute` on the assembly with an instruction record as fabrication or physical
  validity checks plus an executor of geometric edits.
- Making the export formal artifacts (r43) CAD code (OpenSCAD) with drawings (r44).

Everything else came from the grammar structure and my own defaults: the furniture domain, the field
contents, the thresholds, the UI layout, and the loop stopping rules.
