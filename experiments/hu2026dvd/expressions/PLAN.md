# PLAN — System X (data-video authoring)

The design (`design.json`) has 8 processes. It has no goal, no descriptions, no representation notes, no references and no images. From the identifiers I read it as a **data-driven video authoring tool**:

1. An LLM writes scene scripts from a topic, data facts and storytelling guidelines. The scripts are then rendered into a video.
2. The user focuses on one scene and gets the guideline and reference videos that are most relevant to it.
3. The user reviews the video, edits the scripts and renders again. Every render is kept as a version.
4. A generative model makes a stand-alone clip for one scene.
5. Tabular data plus a chart type gives an animated chart.
6. and 7. The user picks a keyframe and clicks an object. A segmentation model gives a mask, the object is removed from the video, and the animated chart is composited in. Process 6 puts the chart where the object was ("full"). Process 7 puts it in a region the user draws ("shape").
8. The user picks one saved version and writes a review of it.

## Stack (repository was empty)

- Frontend: Vite + React + TypeScript (`src/`).
- Backend: Express + TypeScript run with `tsx` (`server/`). It does persistence (a JSON file plus video files in `data/`) and every model call.
- Model provider: the local Claude Code CLI (`claude -p --output-format json --json-schema …`), spawned with `CLAUDECODE` removed. All calls go through one function, `callModel()` in `server/model.ts`.
- Video: the machine has no ffmpeg, so all video tools run in the browser. Canvas draws the frames, WebCodecs `VideoEncoder` encodes them, and `mp4-muxer` writes MP4. If WebCodecs is missing, `MediaRecorder` records WebM instead.

## Representations

| id | type | contents | file |
|---|---|---|---|
| topic | `string` | what the video is about | `src/types.ts` (`Project.topic`) |
| data_facts | `string[]` | one data fact per item, entered by the user | `Project.dataFacts` |
| guidelines | `Guideline[]` `{id,title,text}` | storytelling guidelines; seeded defaults, editable | `Project.guidelines` |
| scripts | `Scene[]` `{id,title,narration,onScreenText,visual{kind,label,value,items[]},background,accent,durationSec,factIndexes[]}` | scene scripts (record*), validated with zod | `src/types.ts`, `server/schemas.ts` |
| video_request | `VideoRequest` `{width,height,fps,scenes[{scene,start,end}],totalSec}` | render job | `src/video/compose.ts` |
| video | `VideoAsset` `{id,url,request,createdAt}` | rendered MP4/WebM | `src/types.ts` |
| video_versions | `VideoVersion[]` `{id,videoUrl,scripts,createdAt,assessment?,review?}` | every render | `Project.versions` |
| reference_videos | `ReferenceVideo[]` `{id,title,description,tags,script?|url?}` | example library; seeded entries render live, uploads play as files | `Project.references` |
| scene_focus | `{sceneId}` | the scene the user selected | Story view state |
| guideline_focus | `Guideline` + score | top retrieved guideline | `src/tools/retrieve.ts` |
| reference_focus | `ReferenceVideo[]` | top 3 retrieved references | `src/tools/retrieve.ts` |
| assessment | `string` | the user's evaluation of the current video, saved on its version | `VideoVersion.assessment` |
| clip_scene | `{sceneId}` | the scene chosen for clip generation | Clip panel state |
| clip_request | `ClipRequest` `{scene fields, width,height,durationSec}` | composed request | `src/tools/clipRequest.ts` |
| clip | `{svg}` | animated SVG made by model_2 | Clip panel |
| chart_data | `{columns:string[], rows:(string|number)[][]}` | CSV or editable table | `Project.chartData` |
| chart_type | `'bar'|'line'|'pie'|'race'` | the user's choice | `Project.chartType` |
| animated_chart | `ChartSpec` (data + type) + `drawChart(ctx,t,box)` | deterministic animated renderer, previewed on a canvas | `src/video/chart.ts` |
| keyframe_full / keyframe_shape | `{time, dataUrl}` | the frame the user picked | Compose view |
| object_point_full / _shape | `{x,y}` normalized | the user's click | Compose view |
| object_mask_full / _shape | `{polygon:[x,y][]}` normalized | from model_3 | Compose view |
| cleaned_video_full / _shape | `VideoAsset` | video with the object removed | Compose view |
| chart_region | `{x,y,w,h}` normalized rectangle | the user drags it | Compose view (shape mode) |
| video_with_chart / video_with_shape | `VideoAsset` | final composite | Compose view |
| reviewed_video | the selected `VideoVersion` | | Versions view |
| video_assessment | `string` | the review of that version | `VideoVersion.review` |

## Transformations

| process | step | implementation | file |
|---|---|---|---|
| P1 | model_1 generate~ (scripts) | `POST /api/scripts` → `generateScripts()` → `callModel` | `server/operations.ts` |
| P1/P3 | tool_1 compose (video_request) | `composeVideoRequest(scripts)` | `src/video/compose.ts` |
| P1/P3 | tool_2 execute (render) | `renderVideo(request)` | `src/video/render.ts` |
| P1/P3 | tool_7 compose (versions) | `POST /api/versions` (uploads the video, appends a version) | `server/index.ts`, `src/api.ts` |
| P2 | human select (scene) | click a scene card → "Guidance" panel | `src/views/StoryView.tsx` |
| P2 | tool_3 select (retrieve) | `retrieveFocus(scene, guidelines, references)` TF-IDF cosine | `src/tools/retrieve.ts` |
| P3 | human evaluate | "Assessment" textarea beside the player | `src/views/StoryView.tsx` |
| P3 | human modify | inline editing of scene fields (scripts_1 → scripts_2) | `src/components/SceneEditor.tsx` |
| P3 | tool_1, tool_2, tool_7 | "Re-render" button (the loop) | same as P1 |
| P4 | human select (clip scene) | "Generate clip" on a scene card | `src/views/StoryView.tsx` |
| P4 | tool_1 compose (clip_request) | `composeClipRequest(scene)` | `src/tools/clipRequest.ts` |
| P4 | model_2 generate~ (clip) | `POST /api/clip` → `generateClip()` (animated SVG, sanitized) | `server/operations.ts` |
| P5 | human specify (chart_type) | segmented buttons | `src/views/ChartView.tsx` |
| P5 | tool_4 translate | `drawChart()` animated canvas renderer | `src/video/chart.ts` |
| P6/P7 | human select (keyframe) | scrub the video + "Use this frame" | `src/views/ComposeView.tsx` |
| P6/P7 | human select (object point) | click on the keyframe | `ComposeView.tsx` |
| P6/P7 | model_3 extract (mask) | `POST /api/mask` → `extractMask()` (Claude vision reads the PNG, returns a polygon) | `server/operations.ts` |
| P6/P7 | tool_5 modify (remove object) | `removeObject(video, mask, range)` decodes frames, inpaints them, encodes | `src/video/inpaint.ts` |
| P7 | human select (chart region) | drag a rectangle on the cleaned frame | `ComposeView.tsx` |
| P6/P7 | tool_6 compose | `composeChart(video, chart, box, range)` | `src/video/overlay.ts` |
| P8 | human select (version) | gallery of versions | `src/views/VersionsView.tsx` |
| P8 | human evaluate | review textarea + save | `VersionsView.tsx` |

## Open choices (default taken)

- Provider: Claude Code CLI with structured output, behind `callModel`.
- Persistence: one project in `data/project.json`; video files in `data/videos/`.
- Layout: four tabs (Story · Chart · Compose · Versions).
- model_2 "clip": the only model available is a language model, so the clip is an animated SVG (a visual artifact).
- model_3 "extract": Claude reads the keyframe image and returns a polygon around the clicked object.
- Mask scope: removal and chart overlay apply to the scene that contains the keyframe.

No images in the design.
