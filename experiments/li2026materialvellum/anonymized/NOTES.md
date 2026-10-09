# NOTES — decisions the design did not determine

The design gave only the three expressions. It had no name beyond "System X", no goal, no description, no process descriptions, no representation descriptions, no references and no images. The identifiers are opaque (`r1`…`r24`). So everything below about *what* the representations contain is my interpretation of the roles, media and structure.

## Interpretation of the design

- **What the system is for.** I read it as a set of tools that turn spatial input on a canvas into images. In process 1 that input is a 3D block-out, in process 2 a sketch, and in process 3 boxes labelled by voice. One `model_1` produces or edits every `visual` artifact, so I treated it as a single image model across all three processes. `model_2` appears only in process 3 and outputs `language*`, so I treated it as a text model that writes per-item descriptions.
- **Tool identities.** I kept each tool's job consistent across processes:
  - `tool_1` (only ever `modify` on `instruction spatial*`) is a stroke beautifier.
  - `tool_2` (`translate`/`modify` between `artifact spatial`) is a 3D scene engine.
  - `tool_3` (`compose`/`translate` everywhere else) is a composer and renderer.
- **Process 1 content.**
  - r1 is a top-down ground plan and r2 is building footprints.
  - r3 is a 2D layout in metres, and r4 is a 3D extruded block scene.
  - r5 is an orbit camera, and r6 is a shaded perspective render.
  - r7 is the image.
  - r8 is lasso strokes painted with an "intent brush". r9 is a polygon selection per lasso, and r10 is one instruction sentence per region.
  - r10 is `language` produced by a *tool*, so the human cannot type it. The text has to come from something the human did spatially. I made it come from the brush they paint with: remove, add detail, brighten, darken, recolor (with a colour picker), or make it sky.
- **Building height.** The design has no human step that sets building height, yet extrusion needs one. I encoded height in the pen colour on the ground plan: Low 4 m, Mid 12 m, Tall 30 m.
- **Process 2 content.** r14 is `instruction language` produced by `tool_3` and not by a human, so there is no user prompt in this mode. Instead, `describeSketch` writes a deterministic description of the recognised shapes (kind, colour, size, position, bounding box). Pen colours are offered as hints for the colours of objects.
- **Process 3 content.**
  - r19 is a recorded voice note per box.
  - The `tool_3 translate` to r20 (`label categorical`) is deterministic keyword matching from the speech transcript to a fixed set of 16 categories. When several categories are mentioned, the first one wins.
  - The transcript comes from the browser's Web Speech API, which runs live during recording. If the API is missing, the user can type what they said. If no category matches, the box is flagged "not recognised — re-record", and generation stays blocked until every box has a label.
  - r21 records are `{boxId, label, region, position, globalPrompt}`. The audio and transcript do not carry into the record, because the design drops r19 after r20.
- **Loops and versions.**
  - Before/after (r7_1 vs r7_2) is kept and shown side by side or toggled.
  - Every `~` step has a regenerate control. Sketch-mode regenerations are kept as #1, #2, … chips.
  - The design does not loop P1.13 back, so the app does not chain edits (r7_3…). "Regenerate edit" re-runs the edit from r7_1.
- **Process connections.** The design lists none, so the three processes are independent modes with separate state. Switching tabs keeps each mode's state.

## Interaction details

- **Tool steps run immediately**, with no confirm button:
  - Beautification runs when each stroke ends.
  - Selections and instructions, and the sketch render and description, are recomputed on every change.
  - Camera changes re-run apply-camera and render live while you drag.
  - The P1.3–P1.5 chain runs on one button, "Build 3D scene".
- **Model steps** each run on an explicit button and show a spinner and an error box with Retry.
- **Raw strokes** (`_1` versions) are kept in state. A "show raw strokes" checkbox overlays them dashed under the beautified `_2` versions.
- **Camera controls:**
  - Drag to orbit (yaw/pitch), wheel to zoom.
  - Sliders for yaw, pitch, distance and FOV, plus a reset to the derived camera r5_1.
  - Pitch is clamped to 5–85° and distance to 8–200 m.
- **Collage generation order:** all descriptions (r22) run in parallel first, then all item images (r23), then the composite (r24). This follows the design's order of steps, not per-item pipelining. Each item can then be redone separately ("New description", "Redraw"), and the collage is recomposed after.
- A side panel in each mode lists every transformation as `[actor op]~` with a status: todo, ready, running, done or error.

## Data formats

- All canvases are 800×600 logical units. The ground plan uses 20 px = 1 m.
- **Visual medium = SVG markup strings.** No image-generation model was available, only the Claude CLI.
- SVGs are displayed through `<img>` / `<image>` data URIs, so any script in them cannot run. The server also strips `<script>`, `<foreignObject>`, `on*` attributes and external hrefs.
- **Model output validation:**
  - It must contain an `<svg>` with a `viewBox` and at least 2 shape elements, and stay under 400 KB.
  - JSON output must have a `description` string of 10–800 characters.
  - Invalid output is retried once, with the reason added to the prompt.
- **Region edits are confined in code, not just by the prompt.** The server composites the model's edited SVG over the original through a mask built from the selection polygons, feathered with a 4 px Gaussian blur. Everything outside the regions stays exactly as the original.
- **Item images** must use a viewBox that matches the slot's aspect ratio. A full-frame opaque background rectangle is stripped if the model adds one. When composited, ids are prefixed per item to avoid collisions.

## Model prompts (`server/models.ts`)

- **model_1 system prompt:** "image model that outputs only a standalone static SVG document". It forbids script, foreignObject, external refs, `<image>` and text, and asks for a rich illustration under about 60 KB.
- **model_2 system prompt:** "writes concise visual descriptions; outputs only a JSON object".
- There is one prompt per operation, built only from the preceding state:
  - **P1.9** gets the render. It must keep the camera, composition and block silhouettes, and interpret the blocks as buildings.
  - **P1.13** gets the image, the region polygons and the region instructions.
  - **P2.4** gets the sketch SVG and the description. It must keep the layout and use stroke colours as hints.
  - **P3.6** gets the global prompt and one record, and returns `{"description"}` in 1–3 sentences.
  - **P3.7** gets one record and its description, and draws an isolated item with no background.

## Libraries and stack

- Vite + React 19 + TypeScript on the front end; Express 5 on the back end, run with `tsx`.
- No state library and no database; all state lives in the browser and is lost on reload, with SVG download buttons for export.
- Vitest, plus jsdom and Testing Library for the render smoke test.
- **Provider:** `server/provider.ts` `callModel()` runs `claude -p --output-format json --tools "" --no-session-persistence --system-prompt …`. It removes `CLAUDECODE` from the environment and runs from the OS temp directory so no project CLAUDE.md is loaded. At most 3 calls run at once (configurable). `MODEL_1` and `MODEL_2` can give the two roles different models.
- Default ports are 8791 for the API and 5179 for Vite, chosen because 8787 was already in use on this machine.
- **Styling:** a light, GitHub-like neutral palette. The canvas is on the left and a sticky pipeline panel is on the right (360 px), stacking on narrow screens.

## Verification

- `tsc` and `vite build` pass, and the 13 tests pass.
- A live end-to-end script called all five model endpoints through the real Claude CLI:
  - Render → image took about 180 s, region edit about 60 s, sketch → image about 19 s, and each item description or drawing about 5–20 s.
  - I inspected the outputs visually: the edit stayed inside its lasso, and the collage composited the items in their boxes.
- There was no browser automation, so the pointer interactions and voice recording in the UI were not driven automatically. The jsdom test only checks that all three modes render.

## Did the design remind me of a published system?

Not of one specific system with any confidence. The identifiers were anonymised and there was no description, so I worked from structure alone. The structure did call up some families of work I know:

- **Process 1** (block-out → camera → render → image generation → region inpainting) resembles 3D-layout-conditioned image generation and "blocking"-style tools, such as depth- or ControlNet-conditioned generation from a coarse 3D scene. It also resembles research prototypes for architects and concept artists that go from massing models to rendered images.
- **Process 2** resembles sketch-to-image systems.
- **Process 3** (regions + spoken labels → per-region text from an LLM → per-region images → composite) resembles region-based or layout-to-image composition, and multimodal "speak and sketch" interfaces.

Choices that came from this background knowledge rather than from the design:

- Reading `tool_2` as a 3D engine and process 1 as a building/massing workflow. I chose buildings and ground-plan footprints because that genre came to mind; the design only says "spatial artifact".
- Treating r5 as a camera and r6 as a depth-shaded render that conditions the image model.
- Treating r8 → r9 + r10 as inpainting masks with per-region instructions, and enforcing locality with a mask composite as inpainting does.
- In process 3, treating model_2 as an LLM that expands short labels into per-object prompts, with model_1 generating each object separately before compositing (the "LLM-planned layout" pattern).
- The fixed category set, keyword matching for voice, intent brushes and pen-height encoding were my own inventions to fill gaps. They do not come from any system I can name.
