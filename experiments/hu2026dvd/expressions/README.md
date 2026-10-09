# System X — data video studio

Built from the Human-AI grammar design in `design.json` (8 processes). You write a brief (a topic, data facts and storytelling guidelines). A model writes the scene scripts, and the scripts are rendered into a video. You can then:

- refine the scripts and re-render;
- get guidance for a single scene;
- generate a clip for a scene;
- build an animated chart;
- replace an object in the video with that chart;
- review saved versions.

## Run

```bash
npm install
npm run dev          # API on :3747 (PORT to change), web on http://localhost:5173
# production
npm run build && npm start   # serves dist/ + API on :3747
```

Requirements:

- Node 20+.
- The `claude` CLI, logged in. All model steps call `claude -p --output-format json --json-schema …`, started with `CLAUDECODE` removed. Set `SYSTEMX_MODEL` to choose a model.
- A Chromium-based browser is recommended. Video encoding uses WebCodecs. If WebCodecs is missing, the app falls back to real-time `MediaRecorder`.

Checks:

```bash
npm run typecheck && npm test
node scripts/e2e.mjs   # with `npm run dev` running: walks through all 8 processes headlessly (needs Playwright's chromium)
```

Data is stored in `data/project.json` and `data/videos/`. "Reset example" in the header restores the seeded example.

## Design → code

The model provider seam is `callModel()` in `server/model.ts`. It is the only place that knows about the Claude CLI.

| Process | Step | Code |
|---|---|---|
| 1 | `[model_1 generate]~` topic + data_facts + guidelines → scripts | `generateScripts` in `server/operations.ts` (`POST /api/scripts`), triggered in `src/views/StoryView.tsx` (`generate`) |
| 1, 3 | `[tool_1 compose]` scripts → video_request | `composeVideoRequest` in `src/video/compose.ts` |
| 1, 3 | `[tool_2 execute]` video_request → video | `renderVideo` in `src/video/render.ts` (scene drawing in `src/video/scene.ts`, encoding in `src/video/encoder.ts`) |
| 1, 3 | `[tool_7 compose]` video → video_versions | `renderAndVersion` in `src/pipeline.ts` → `POST /api/versions` in `server/index.ts` |
| 2 | `[human select]` scene_focus | "Guidance" button on a scene card (`StoryView.tsx`, `focusScene`) |
| 2 | `[tool_3 select]` → guideline_focus + reference_focus* | `retrieveFocus` in `src/tools/retrieve.ts`; shown in `GuidancePanel` |
| 3 | `[human evaluate]` assessment | "Your assessment" textarea → `PATCH /api/versions/:id` |
| 3 | `[human modify]` scripts_1 → scripts_2 | `src/components/SceneEditor.tsx`, plus reorder, add and delete in `StoryView.tsx` |
| 3 | loop back to video_1 | "Re-render with edited scripts" (`rerender`) |
| 4 | `[human select]` clip_scene | "Generate clip" on a scene card (`makeClip`) |
| 4 | `[tool_1 compose]` → clip_request | `composeClipRequest` in `src/tools/clipRequest.ts` |
| 4 | `[model_2 generate]~` → clip | `generateClip` + `sanitizeSvg` in `server/operations.ts` (`POST /api/clip`) |
| 5 | `[human specify]` chart_type | chart-type buttons in `src/views/ChartView.tsx` |
| 5 | `[tool_4 translate]` → animated_chart | `translateChart` / `drawChart` in `src/video/chart.ts` |
| 6, 7 | `[human select]` keyframe | "Use this frame" in `src/views/ComposeView.tsx` (`pickKeyframe`) |
| 6, 7 | `[human select]` object_point | `PointPicker` in `ComposeView.tsx` |
| 6, 7 | `[model_3 extract]` → object_mask | `extractMask` in `server/operations.ts` (`POST /api/mask`; Claude looks at the keyframe PNG) |
| 6, 7 | `[tool_5 modify]` → cleaned_video | `removeObject` / `inpaintFrame` in `src/video/inpaint.ts` |
| 7 | `[human select]` chart_region | `RegionPicker` in `ComposeView.tsx` |
| 6, 7 | `[tool_6 compose]` → video_with_chart / video_with_shape | `composeChart` in `src/video/overlay.ts` (full mode places the chart with `fitBox`) |
| 8 | `[human select]` reviewed_video | version grid in `src/views/VersionsView.tsx` |
| 8 | `[human evaluate]` video_assessment | "Your review" textarea → `PATCH /api/versions/:id` |

Representation types live in `shared/types.ts`. Model output schemas live in `shared/schemas.ts`.
