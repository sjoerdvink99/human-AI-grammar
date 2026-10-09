# NOTES — decisions the design did not determine

The design fixed the eight processes, their representations, the actors and the trigger order. Everything below was my choice.

## Stack and infrastructure

| Topic | Choice |
| --- | --- |
| Backend | Python 3 + FastAPI, synchronous endpoints, which run in the thread pool so long model calls don't block other requests. |
| Frontend | One static HTML page with vanilla ES-module JavaScript and hand-written CSS. No framework and no build step. |
| Video I/O | The ffmpeg binary bundled with `imageio-ffmpeg`. H.264 MP4 at 640×360, 24 fps, yuv420p, faststart. |
| Drawing | Pillow + NumPy. Inpainting and masks use OpenCV (`opencv-python-headless`). |
| Voiceover | macOS `say` (the system voice), padded or trimmed per scene and muxed as AAC. Videos are silent where `say` is missing. |
| Persistence | One project at a time, kept in `data/project.json`, with media files in `data/media/`. *New project* resets it. There are no accounts. |
| Long operations | Synchronous HTTP requests with spinners and status lines in the UI. There is no job queue or streaming. |
| Tests | pytest. One end-to-end API test covers all eight processes with `call_model` stubbed, plus unit tests for the parser and validators. |

## Model steps (all through `backend/llm.py::call_model`)

| Step | Choice |
| --- | --- |
| Provider | `claude -p <prompt> --output-format json --system-prompt … --json-schema …`, started with `CLAUDECODE` removed. Text-only calls use `--tools ""`. The segmentation call uses `--tools Read --add-dir <frame dir>`. Each role can get its own model through `SYSTEMX_MODEL_n_MODEL`. |
| model_1 "fine-tuned language model" | No fine-tuned model was available, so a system prompt casts the model as a screenwriter specialised in data-video openings, told never to invent numbers. The prompt contains the topic, the numbered data facts and all eight guidelines (id, name, principle, how). The model returns 3–4 scenes with `title, guideline_id, voiceover, visuals, rationale, duration_s`. The JSON schema limits `guideline_id` to the known ids. The server checks that the voiceover and visuals are non-empty, clamps the duration to 3–10 s, and retries once when validation fails. |
| model_2 "video generation model" | No video model was available. Claude acts as a text-to-video model and returns a structured animated-shot spec: background gradient, ground, camera zoom, and up to 6 objects, each with a kind from a fixed list of 24 props, a position, size, colour, entrance animation and start time. The server clamps and validates the spec, and the local renderer draws it as a 5-second clip. |
| model_3 "object segmentation model" | Claude opens the keyframe PNG with the Read tool and returns `{label, polygon}` for the object at the clicked pixel. The polygon must contain the click (12 px tolerance). If the polygon misses the click, the call fails, or the call times out, a deterministic colour flood fill from the click is used, and the UI says "Fallback colour segmentation". The mask is dilated by 9 px. |

## Tools

| Tool | Choice |
| --- | --- |
| tool_1 | Builds a "Vadoo-compatible" JSON request: title, resolution, fps, voice, captions, and per scene `voiceover, visual_prompt, duration_s, guideline_id, on_screen_title` (the title shows on the first scene only). For clips it builds `{prompt = visuals + narration, style = topic + guideline, duration_s: 5}`. |
| tool_2 (Vadoo) | No API key, so `video_api.execute()` is a local stand-in with the same contract. It maps keywords in each scene's `visuals` to up to 3 procedural props (globe, skyline, crowd, car, coin, ice, …). A figure found in the visuals becomes a count-up "number" object for striking-number scenes. Camera move and entrance animation come from the scene's guideline. The background gradient is picked by a hash of the text. Captions show the voiceover, and the scene lasts max(script duration, voice length + 0.6 s), capped at 12 s. **The camera moves only during the first 2 s of a scene**, so keyframes after that are stable enough for inpainting. |
| tool_3 | A lookup from the scene's `guideline_id` to the guideline and its reference clips. The view follows unsaved edits to the guideline dropdown. |
| tool_4 | Animation templates drawn with Pillow. **Line:** the line draws itself from left to right. **Bar:** bars grow with a stagger. **Pie:** wedges sweep clockwise. The build-up takes 2.5 s, then the chart holds. Full mode draws a white rounded panel with a title, y-ticks, x-labels, value labels and a legend for multiple series. Shape mode draws only the marks on transparency (lines get a filled area so they read as a shape). Parsing accepts CSV, TSV or `;`, detects a header, strips `% $ € £` and thousands separators, needs at least 2 and at most 40 rows, and rejects negative values for pie charts. |
| tool_5 | `cv2.inpaint` (Telea, radius 7) runs **once on the keyframe**. The filled patch is feather-blended into every frame from the keyframe time to the end of that scene, which gives a stable fill with no flicker. Frames before the keyframe keep the original object, so the object "turns into" the chart at the paused moment. |
| tool_6 | **Full chart:** a 3:2 chart panel centred on the object's bounding box, at least 280 px wide and at most 60% of the frame width, kept above the caption band. The chart animation starts at the keyframe. **Shape:** the selected rectangle of the mark-only chart is stretched into the object's bounding box and **tinted with the removed object's mean colour**, which is my reading of "stylized". |
| tool_7 | Appends a version record (number, URL, duration, scene times, script snapshot, request, timestamp, assessments). Newer versions never overwrite older ones. |

## Content I invented

- **Guidelines:** the design names "cinematic guidelines for opening scenes" but gives no content. I wrote 8:
  1. Establish the setting
  2. Lead with a striking number
  3. Pose a question
  4. Anchor in a human scale
  5. Juxtapose a contrast
  6. Use a visual metaphor
  7. Zoom from big picture to detail
  8. Show change over time

  Each has a principle and a "how".
- **Reference videos:** no professional footage is available. Each guideline has 2 illustrative clips, rendered locally at startup with the same renderer, and each caption describes the kind of professional opening it stands in for (for example, "Climate explainer: an ice block that melts…"). They are clearly stand-ins.

## Layout and interaction

- **Tabs:** three tabs, "1 · Script & demo", "2 · Data chart" and "3 · Gallery" (with a version count badge), plus a "New project" button.
- **Tab 1:**
  - Left: topic, then a data-facts list with add/remove, then *Generate opening scenes*.
  - Centre: editable scene cards. Each card has a title, voiceover, visuals, a guideline dropdown, a duration, a guideline chip, a "Why this guideline" rationale, a *5-s clip* button and an inline clip player. Clicking a card selects the scene (P2).
  - Right: the video player with an assessment box, *Save assessment* and *Regenerate full demo*. Below that, a guideline list with "● used" markers, the focused guideline highlighted in yellow and its "how" shown, and two looping reference clips.
- **Generation flow (P1):** generating scripts automatically continues to render the video, as in P1. Scripts appear first while the video renders.
- **Revision (P3):** edits stay in a local draft, marked "edited — not yet rendered". *Regenerate* saves any typed assessment to the version being judged, then renders scripts_2 as a new version. Earlier versions and their scripts stay in the gallery.
- **Clips (P4):** a clip uses the last rendered script of the scene. A note appears when the clip came from an earlier version of the scene.
- **Tab 2:**
  - Left: paste box, title, a Line/Bar/Pie segmented control, *Create animated chart*, a looping preview and a parsed table.
  - Right: a *Complete chart / Chart shape* toggle and numbered step cards: (1) player + *Use this frame*, (2) click the frame, which shows a red dot and a red mask overlay with a yellow outline, (3) the inpainted video, (4, shape mode only) drag a rectangle on a checkerboard view of the chart, (5) the result.
  - After the click, segmentation → inpainting (→ compose in full mode) run as a chain without stopping, because the design has no human step between them. Clicking again re-selects the object.
- **Replacement source:** replacement always uses the current video (video_1). Composites are kept per mode and are not added to the gallery, because the design routes only tool_2 output through tool_7.
- **Gallery (P8):** a grid of version cards (newest first, with the current one outlined). Selecting one shows it **side by side with the current version**, with both script snapshots, a "Your judgement of this video" box and the list of earlier notes. Design and review notes are stored on the version, tagged `design` or `review`.
- **Styling:** neutral light UI, indigo accent (#3d5afe), system font, dark header.

## Known limitations

- The stand-in video API draws simple flat props, not footage. Segmentation and inpainting run on those frames.
- If an object moves after the keyframe (for example, a clip-model "slide" entrance still running), the static mask won't track it.
- Headless Chromium can't play the H.264 MP4s (no proprietary codecs). Chrome, Safari and Firefox on macOS can.

## Did the design remind me of a published system?

Yes, partly. The combination reminded me of visualization research on **opening scenes of data videos**. That includes a design-space or guideline study of how professional data videos open (hook number, question, setting, contrast, metaphor are common categories in that line of work and in film and journalism practice), followed by an authoring or ideation tool built on those guidelines. The design adds a fine-tuned LLM writing guideline-linked scripts, a commercial text-to-video service (Vadoo), and segmentation + inpainting to replace a generated object with a real-data chart. I can't name the specific paper or system with confidence, and per the instructions I didn't look it up.

What came from that general background rather than from the design:

- **The guideline content and taxonomy.** The 8 guidelines and their wording come from my general knowledge of data-storytelling and film-opening conventions (attention hooks, establishing shots, posing questions, human-scale anchors, contrast, visual metaphor, zoom, time-lapse), not from the design.
- **Linking each scene to one guideline with a rationale.** The design asks for "guideline-linked" scripts. Showing a short "Why this guideline" rationale per scene is my interpretation, influenced by how such tools usually explain suggestions.
- **The "object turns into chart at the paused moment" behaviour** and tinting the stylized shape with the object's colour are my own interpretations, not knowledge of the original.

Everything else (stack, prompts, schemas, layout, renderer, inpainting method, fallbacks) was chosen for this build without reference to any specific system.
