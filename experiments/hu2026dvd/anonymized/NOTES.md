# NOTES — decisions the design did not determine

The design (`design.json`) gives eight processes with opaque identifiers (`r1`…`r31`), no goal, no system or process
descriptions, no representation descriptions, no references and no images. So **every** semantic decision below
is mine. The structure fixed only which steps exist, who performs them, the role and medium of each
representation, what each step can see, and how the processes connect.

## Overall interpretation

| Design fact | My reading |
| --- | --- |
| P1: instruction text + two text collections → model makes records → tool compose → instruction record → tool execute → visual → tool compose → visual collection | A brief (r1), style references (r2*) and source documents (r3*) go to a model that drafts **visual elements** (r4*). These are composed into a **scene spec** (r5) and rendered into a **scene** (r6), and the scene is added to a **snapshot gallery** (r7*). |
| r3* is kept beside r4* and reused in P2 with r8* | r3* holds the source documents. Elements cite them, so P2 is **provenance**. |
| P2: human selects a record → tool selects text + images | Selecting an element retrieves the quoted **passage** (r10) and the linked **source images** (r11*). |
| P3 ends at its own start state (`r4_1`, `r6_1`, `r7_1`) | A **critique → edit → re-render** loop. Each round adds a snapshot, and earlier rounds stay in the gallery. |
| P4: select record → tool compose → model_2 generate visual | **Illustrate** one element with a second, generative model. |
| P5: table → human picks a categorical → tool translate → visual | **Data → chart**. The categorical is the chart type. |
| P6/P7: two human selects (visual, then spatial) → model_3 extract spatial → tool modify → (P7: human picks a position) → tool compose with r18 | **Cut an object out of the scene** (region crop, then click points, then a segmentation polygon from a vision model, then a masked cutout) and **compose it onto the chart**. P6 places it automatically; P7 lets the human place it. |
| P8: select one visual from r7* → evaluate in language | **Review** one past round in the gallery. |

Overall, I read this as a "pictorial infographic studio".

## Representations: contents and formats

- **r1 brief**: free text.
- **r2 style references**: list of `{title, text}`. I treat them as text descriptions, not images, because the medium is language.
- **r3 source documents**: list of `{id, title, text}`, pasted by the user. There is no file parsing (PDF etc.).
- **r4 visual element**: `{id, name, kind ∈ {illustration, icon, headline, text, annotation, shape}, description, text, x, y, w, h, color, svg, sources[{docId, quote}]}` on a fixed **1000×700** canvas. Illustrations, icons and shapes carry inner SVG in a `0 0 100 100` viewBox. I chose SVG because no raster image model is available.
- **r5 scene spec**: `{width, height, background, layers[]}`, with layers ordered by kind (shapes behind, then illustrations, icons, annotations, text, headline).
- **r6 scene**: a standalone SVG string. It is rasterized in the browser only when needed (cropping for P6/P7).
- **r7 gallery**: snapshots `{round, createdAt, scene, critique?, reviews[]}`. The critique r12 is stored on the snapshot it led to, and P8 reviews r31 are stored on the reviewed snapshot.
- **r8 source images**: uploaded images with an editable caption and an optional link to one document. **Important choice:** r8 is not in model_1's state, so the model cannot link elements to images. Instead tool_3 finds them deterministically: images attached to a document the element cites come first, then images whose caption shares terms with the element.
- **r10 passage**: the quote is located verbatim, then case- and whitespace-insensitively, then by the longest run of quote words (≥3). It is shown highlighted with about 220 characters of context. Quotes that cannot be found are flagged in red instead of being hidden.
- **r14 illustration request**: `{subject, description, style, palette[3], aspect}`, derived from the element. The style default is "flat vector infographic illustration, no text", and the aspect comes from the element's box ratio. It is shown read-only, because no human step edits it.
- **r15 illustration**: an SVG produced by model_2. The canvas is 400×400, 600×400 or 400×600 depending on the aspect.
- **r16 table**: CSV/TSV/semicolon text, pasted or uploaded. Quoted fields are supported, and numeric cells are coerced to numbers.
- **r17 chart type**: one of bar, column, line, pie, scatter. Columns are **auto-chosen**: the first text column gives the labels and the first numeric column gives the values (the second numeric column is y for scatter). I did not add a column picker because the design has only the type as the human input.
- **r18 chart**: hand-written SVG renderer, no chart library. It also records the plot area and mark rectangles so tool_6 can place pictographs.
- **r19/r24 region**: a rectangle dragged on the scene. It is rasterized and upscaled to about 480px.
- **r20/r25 points**: click = positive point, Shift-click or right-click = negative point.
- **r21/r26 mask**: a polygon. Model_3 returns it normalized to 0..1 and the server converts it to crop pixels.
- **r22/r27 cutout**: a transparent PNG trimmed to the polygon bounds.
- **r28 placement**: `{x, y, w, h}` set by dragging and corner-resizing on the chart, clamped to the chart bounds.
- **r23/r29 pictorial chart**: the chart SVG with the cutout embedded as a PNG data URL. The user can keep and download it.
- **r30/r31**: the selected snapshot and a list of free-text reviews.

## Model prompts and validation

- **One function**, `callModel()` in `server/model.ts`. It runs `claude -p <prompt> --output-format json --json-schema <schema> --system-prompt <role prompt> --no-session-persistence` with `CLAUDECODE` deleted from the env. Calls without images use `--tools ""`. Model_3 gets `--tools Read --allowedTools Read --add-dir <tmpdir>` so it can see the PNGs. The result is read from `structured_output`, with a regex JSON fallback.
- **model_1** (designer): makes 5–12 elements with exactly one headline. Every factual claim must cite a verbatim quote, and the SVG is limited to basic shapes. Validation in code: the kind must be in the enum; geometry is clamped into the canvas; the SVG is sanitized with an allow-list of tags, with handlers, hrefs, external `url()` and script/style/foreignObject/image/use stripped; citations to unknown documents are dropped; ids are deduplicated.
- **model_2** (illustrator): a separate system prompt that asks for one polished SVG in a given viewBox, shapes and gradients only. The output is sanitized and rejected if it has no drawable shapes.
- **model_3** (segmenter): gets the clean crop **and** an annotated copy (10% grid with labels, plus green and red point markers drawn by the client). It returns a 12–60-vertex polygon. The server checks that every positive point is inside and every negative point is outside. If the check fails, it retries once with feedback. If it still fails, the result is shown with a warning, so the human sees it before cutting.
- All generative steps show a spinner and errors, and can be regenerated ("Regenerate elements", "Generate another", "Extract again"). Results are only committed through explicit buttons ("Keep result", "Re-render & snapshot").

## Interaction and layout

- Top bar with tabs: Scene (P1–P3), Illustrate (P4), Chart (P5), Pictorial chart (P6/P7), Gallery (P8). Each tab label carries a small P-number hint for traceability.
- The left column is always visible. It holds the Sources (r1, r2*, r3*, r8*), the generate button, and a "Load example" button with invented urban-beekeeping content and a CSV.
- Scene tab: the rendered scene sits under a direct-manipulation overlay of element boxes (move, plus a corner resize handle). The right inspector has the element list, the provenance (P2) and the element editor (P3). The critique box and "Re-render & snapshot" are under the scene. **While editing, the scene image stays at the last render (r6_1)** and a "Edited — scene shows the last render" pill appears. That follows the design, where r6 only changes after tool_1 → tool_2.
- P6 and P7 are **one panel** with an "Auto placement / Place manually" toggle and a three-column step layout (region → object → chart).
- P6 auto-placement rule (deterministic, since P6 has no human placement step): put a copy above/beside every mark for bar/column/line/scatter, and one copy in the top-right corner for pie. `autoPlacements` also supports a faded "background" mode, but it is not exposed.
- "Regenerate elements" replaces the current elements and adds a new round. The old rounds stay in the gallery. There is no "restore elements from round N", because the design has no such step.
- Styling: warm off-white background, charcoal ink, honey-amber accent, Inter/system font, hand-written CSS.
- Persistence: the whole state goes to `localStorage`, debounced. If the quota is exceeded, it retries without the source images. There is no server-side database.

## Libraries and stack

- React 19 + Vite + TypeScript for the front end. Express + `tsx` for the API. Vitest for unit tests. Playwright for the e2e walkthrough. `concurrently` for `npm run dev`.
- No chart, canvas, state-management or UI libraries. Charts, SVG rendering, sanitizing and masking are hand-written.

## Verification performed

- `tsc -b` is clean, 11 unit tests pass, and `vite build` succeeds.
- `scripts/e2e.mjs` ran all eight processes in headless Chromium with real CLI model calls: elements were generated (10 elements, all citations found in the sources), provenance was highlighted, the element was dragged and the scene re-rendered (round 2), an illustration was generated, a column chart was rendered, an object was extracted and composed automatically (P6) and manually (P7), and a review was added to a gallery round. Every transformation in the design is reachable in the running app.

## Did the design remind me of a published system?

Not of one specific system. With opaque identifiers and no descriptions, I could not recognize a single paper. The
structure does resemble a family of systems I know:

- **Pictorial / embellished chart authoring** (for example DataSelfie, Infonice, and especially *ChartSpark*, which generates pictorial visualizations, and work that composes extracted image objects onto charts). P5–P7 (table → chart type → chart, then cutting an object out of an image with clicks and placing it on the chart) led me to read P6/P7 as "decorate a chart with an object cut from the scene".
- **Click-prompted segmentation (Segment Anything)**. The pattern `select visual → select spatial → model extract → spatial` reads exactly like SAM: a box or region plus positive and negative clicks give a mask. My choices here came from that knowledge rather than from the design: positive and negative clicks, Shift/right-click for negatives, a polygon mask, and a transparent cutout.
- **Grounded / provenance-linked generation** (citation-backed summarisation tools). P2 "select a generated record → tool retrieves text span + images" led me to require verbatim quotes from model_1 and highlight them in context.

Choices that came from this background knowledge rather than from the design:

1. Calling the overall domain "infographic / pictorial chart" at all.
2. Reading r17 as a chart type, and the chart-type set {bar, column, line, pie, scatter}.
3. SAM-style click prompting and the polygon mask (r20, r21), and the idea of placing pictographs on data marks in P6.
4. Verbatim-quote citations as the record-to-source link (r4 → r10).
5. Treating r7* as a version history of the scene, rather than, for example, a set of per-element renders or alternative layouts. This also came from the general "keep earlier rounds for comparison" convention in iterative-refinement systems.

If the original system is something else (for example a comic/storyboard generator or a slide generator), the
grammar mapping would still hold, but the prompts, the element schema and the auto-placement rule would need to change.
