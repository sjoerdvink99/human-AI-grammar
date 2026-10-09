# NOTES — decisions the design did not determine

The design had only the eight expressions. It had no goal, no system or process descriptions, no representation descriptions, no references and no images. Everything below is my choice.

## Overall interpretation
- I read the system as a **data-video authoring tool**. This comes from the identifiers: topic, data_facts, guidelines, scripts, video_request, reference_videos, chart_data, animated_chart, keyframe, object_point, object_mask, cleaned_video, and video_with_chart.
- The processes are combined into one application with four tabs:
  - **Story**: processes 1–4.
  - **Chart**: process 5.
  - **Compose**: processes 6 and 7, chosen with a mode toggle.
  - **Versions**: process 8.
- Shared identifiers share state. `scripts` is the project's scene list. `video_1` is the current (latest) version. `animated_chart_1` is derived from the project's chart data and chart type.
- No process had a trigger, so every process starts with a button click. The exception is process 1, which runs the whole chain (generate → compose → execute → add version) from one "Generate scripts & render" click. Its expression has no human step between the model and the tools.
- I read process 6 ("full") as **replacing the removed object with the chart**: the chart goes in the object's bounding box, enlarged to a readable minimum. I read process 7 ("shape") as **removing the object, then placing the chart in a region the user draws**. The names `_full` and `_shape` support other readings too.

## Representations (formats)
- **topic**: free text.
- **data_facts**: a list of strings, one fact per item, with numbered indexes so scenes can cite them (`factIndexes`).
- **guidelines**: `{id, title, text}`. Eight data-storytelling guidelines are seeded (hook, one idea per scene, context, visual comparison, short text, consistent colour, pacing, takeaway). They are editable.
- **scripts** (`artifact record`): `{id, title, narration, onScreenText, visual{kind ∈ headline|big_number|bar|comparison|quote, label, value, items[]}, background, accent, durationSec, factIndexes}`.
  - Validation uses zod on the server.
  - Durations are clamped to 3–10 s, fact indexes are filtered to ones that exist, and comparison scenes keep at most 2 items.
- **video_request**: `{width 960, height 540, fps 24, totalSec, scenes[{scene,start,end}]}`. Scenes play back to back with a 0.35 s cross-fade.
- **video / versions**: an MP4 (H.264, or VP9 in MP4) is uploaded to the server. A version is `{number, video, scripts snapshot, assessment?, review?}`.
- **reference_videos**:
  - Five seeded examples, stored as small scene scripts and rendered live on a canvas. I had no video files to ship.
  - Users can upload their own videos with a title, description and tags.
- **guideline_focus / reference_focus**: the top-1 guideline and top-3 references, each with a match score.
- **assessment** (process 3) and **video_assessment** (process 8): free text saved on the version. They are kept apart as `assessment` and `review`.
- **clip_request**: the scene's fields plus palette, size and duration. **clip**: a self-contained animated SVG with a caption.
- **chart_data**: `{columns, rows}`. The first column holds categories or time steps; the other columns are numeric series. It can be edited as a table or replaced by pasted CSV.
- **chart_type**: bar | line | pie | race (bar-chart race).
- **animated_chart**: a deterministic renderer `drawChart(ctx, chart, t, box)` plus its duration. It is not a stored video file, so it is drawn crisply at any size when composited.
- **keyframe**: a PNG data URL plus its time.
- **object_point**: normalized x and y.
- **object_mask**: a normalized polygon plus the object's name.
- **chart_region**: a normalized rectangle.
- **cleaned_video**: carries `removedRegion` (the mask's bounding box) and `segment`, so tool_6 knows where and when to place the chart. Neither is in the design's state after tool_5.

## Model steps (all through `callModel()` → `claude -p --output-format json --json-schema …`, with `CLAUDECODE` unset, run in an empty temp dir)
- **model_1 generate (scripts)**:
  - The system prompt casts the model as a data-video scriptwriter. It must use only the given numbers, use the five visual kinds, keep one palette across scenes, and write 4–7 scenes (hook → development → takeaway).
  - The user prompt contains only the topic, the indexed facts and the guidelines.
- **model_2 generate (clip)**:
  - No video model is available, so the clip is an **animated SVG** (SMIL/CSS) produced by Claude.
  - The SVG is sanitized: scripts, foreignObject, event handlers and external hrefs are stripped.
  - It is displayed through an `<img>` (data URL), which isolates it further. It can be regenerated and downloaded.
  - The clip is not inserted back into the video, because the design has no such step.
- **model_3 extract (mask)**:
  - Claude is given the keyframe PNG (written to a temp dir and opened with the Read tool) and the click coordinates.
  - It returns a polygon with 8–40 vertices plus the object's name.
  - Coordinates are clamped, and a polygon with fewer than 3 points is rejected. Clicking again gives a new mask.
- Validation errors and CLI failures appear as errors in the UI. Every generative step can be re-run.

## Tool steps
- **tool_2 execute**: renders in the browser, because ffmpeg is not installed. Scenes are drawn on a canvas, then encoded with WebCodecs `VideoEncoder` and muxed to MP4 with `mp4-muxer`. If WebCodecs is missing, the app records WebM in real time with `MediaRecorder`.
  - There is no audio. Narration appears as subtitles.
  - Animations: titles fade and slide in, big numbers count up, bars grow one after another.
- **tool_3 select**: TF-IDF cosine retrieval in the browser. The scene's text is extended with words describing its visual kind, and guidelines and references are ranked against it.
- **tool_5 modify**: decodes frames by seeking a `<video>` element, then inpaints the dilated mask region by blending row-wise and column-wise linear interpolation from the mask border.
  - This works well on the generated flat or gradient backgrounds and poorly on real footage.
  - It is applied **only to the scene that contains the keyframe**. The mask is static, with no tracking.
- **tool_6 compose**: draws the animated chart on a semi-opaque panel inside the box during that scene's time segment. The chart animation starts at the segment's start and fades in over 0.3 s.
- **tool_7 compose**: the server appends a version and makes it current.

## UI / interaction
- Dark theme, system fonts, no UI library.
- **Story** has three columns:
  - **Brief**: topic, facts, collapsible guidelines, the generate button and a collapsible reference library.
  - **Scripts**: scene cards with a live thumbnail, Edit / Guidance / Generate clip, and reorder and delete controls.
  - **Video**: the player, the re-render button, the assessment box, and the guidance and clip panels.
- Before the first render, the video column shows a live canvas preview.
- The re-render button is highlighted when the scripts differ from the current version.
- **Compose** has a three-step column layout. The mask is shown as a blue polygon over the keyframe, and the chart region as a dashed rectangle drawn by dragging.
- **Versions** shows a grid (newest first). Selecting a version shows its player, a summary of its scenes, the assessment written during editing, and a review box.
- Long-running steps show a spinner and a progress bar. Errors can be dismissed.

## Stack, persistence, other
- Vite, React 19 and TypeScript on the frontend; Express 5 run with `tsx` on the backend; zod 4, used for model output schemas and for converting them to JSON Schema.
- There is one project, stored in `data/project.json`, and video files are stored in `data/videos/`. It is seeded with an example (solar power growth) so the app is usable immediately.
- Ports: API on 3747, web on 5173. I moved the API off 3001 because another process on this machine took that port during testing.
- Tests:
  - Vitest unit tests cover tool_1, tool_3, tool_4, SVG sanitization, schema rejection and box fitting.
  - `scripts/e2e.mjs` is a Playwright walkthrough that ran all 8 processes successfully against the real Claude CLI.

## Did the design remind me of a specific published system?
It did not match one system I can name with confidence. Parts of it reminded me of several published lines of work, and those memories shaped some of my choices:

- **Fact-driven data-video generation**, such as AutoClips (Shi et al.), which turns a sequence of data facts into a data video. I took the "data facts → scenes that cite facts" structure (`factIndexes`) and the scene visual types (big number, comparison, bar) from that genre, not from the design.
- **Point-prompted segmentation in the style of Segment Anything (SAM)**. "Human picks a keyframe, clicks a point, model_3 extracts a mask" strongly suggested a SAM-like model. That is why I made model_3 a click-to-polygon segmenter and called it "the object under the point".
- **Video inpainting / object removal followed by embedding a visualization into footage**, as in research on augmenting videos with embedded charts. This led me to read tool_5 as object removal by inpainting, and process 6 as "the chart replaces the removed object".
- **Text-to-video generators** (Sora, Runway, and similar). This is why I read model_2 as a clip generator for one scene. The animated-SVG substitute exists only because no video model was available.
- The idea of retrieving **reference examples plus design guidelines for the scene in focus** reminded me of example-based design-support tools in general, but not of a particular paper.

These are my own choices and did not come from knowledge of any published system: the four tabs, the TF-IDF retrieval, the guideline list, the "full" vs "shape" interpretation, and limiting the edit to the keyframe's scene.
