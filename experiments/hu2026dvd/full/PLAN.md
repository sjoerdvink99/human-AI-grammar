# PLAN — System X (data-video opening-scene ideation)

Design: `design.json` (8 processes, parsed OK with `design`; no references, no images).

## Stack (repository was empty — recommended default taken)

- **Backend:** Python 3 + FastAPI (`backend/`). Video I/O with the ffmpeg binary shipped by `imageio-ffmpeg`, frames drawn with Pillow + NumPy, inpainting with OpenCV (`cv2.inpaint`). Voiceover audio via macOS `say` when present.
- **Frontend:** one static page, vanilla ES modules, no build step (`frontend/`), served by FastAPI.
- **Model provider:** every model step goes through `backend/llm.py::call_model()` which runs `claude -p … --output-format json` (with `--json-schema` for structured output) with `CLAUDECODE` removed from the environment. Swap provider by replacing that one function.
- **Persistence:** one project in `data/project.json`; media files in `data/media/`.
- **Tests:** pytest on the deterministic tools (tool_1, tool_2 renderer, tool_4, tool_5, tool_6, tool_7, validators) with the model function stubbed.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| topic | `str` | story topic (instruction) | `backend/state.py`, input in `frontend/app.js` |
| data_facts | `list[str]` | selected data facts | same |
| guidelines | `list[Guideline]` {id,name,principle,how} | 8 built-in cinematic opening-scene guidelines | `backend/guidelines.py` |
| reference_videos | `list[ReferenceVideo]` {id,guideline_id,caption,url} | illustrative example clips per guideline, rendered locally | `backend/guidelines.py` |
| scripts | `list[Scene]` {title,guideline_id,voiceover,visuals,rationale,duration_s} | scene-by-scene scripts | `backend/state.py` |
| video_request | `VideoRequest` {title,resolution,fps,voice,scenes:[{index,duration_s,voiceover,visual_prompt,spec}]} | Vadoo-style request | `backend/tools.py::compose_video_request` |
| video | `Version` (current) {id,url,duration,scene_times} | generated demo | `backend/state.py` |
| video_versions | `list[Version]` with script snapshot + assessments | gallery | `backend/tools.py::gallery_compose` |
| scene_focus / guideline_focus / reference_focus | scene index / highlighted guideline / reference clips | selection | `backend/tools.py::link_guideline` |
| assessment | `str` stored on the current version | evaluation | `state.py` |
| clip_scene / clip_request / clip | scene index / `{scene,duration_s:5,prompt}` / mp4 url | single-scene clip | `backend/models.py::generate_clip` |
| chart_data | `{columns, rows}` parsed from pasted CSV/TSV | tabular | `backend/charts.py::parse_table` |
| chart_type | `"line"|"bar"|"pie"` | categorical | buttons |
| animated_chart | `ChartSpec` + preview mp4 | visual | `backend/charts.py` |
| keyframe_full / keyframe_shape | `{time, frame_url}` | paused frame | `backend/tools.py::extract_keyframe` |
| object_point_full / _shape | `{x,y}` pixels | click | frontend |
| object_mask_full / _shape | polygon + PNG mask | spatial | `backend/models.py::segment_object` |
| cleaned_video_full / _shape | mp4 | inpainted | `backend/tools.py::inpaint_video` |
| chart_region | `{x0,y0,x1,y1}` normalised on chart | spatial selection | frontend drag |
| video_with_chart / video_with_shape | mp4 | composites | `backend/tools.py::compose_chart_*` |
| reviewed_video / video_assessment | version id / text | gallery review | `state.py` |

## Transformations (process order)

| process | step | implementation |
| --- | --- | --- |
| 1 | `[model_1 generate]~` | `models.generate_scripts()` (Claude, schema-validated, guideline ids enforced) |
| 1,3 | `[tool_1 compose]` | `tools.compose_video_request()` |
| 1,3 | `[tool_2 execute]` | `video_api.execute()` → local renderer `render.render_video()` (stand-in for Vadoo) |
| 1,3 | `[tool_7 compose]` | `tools.gallery_compose()` |
| 2 | `[human select]` | click a scene card |
| 2 | `[tool_3 select]` | `tools.link_guideline()` → right panel highlights guideline + reference clips |
| 3 | `[human evaluate]` | assessment textarea under the video |
| 3 | `[human modify]` | editable scene cards; "Regenerate full demo" closes the loop |
| 4 | `[human select]` | "5-s clip" button on a scene card |
| 4 | `[tool_1 compose]` | `tools.compose_clip_request()` |
| 4 | `[model_2 generate]~` | `models.generate_clip()` (Claude writes an animation spec; rendered to 5 s) |
| 5 | `[human specify]` | paste table + line/bar/pie buttons |
| 5 | `[tool_4 translate]` | `charts.render_chart_video()` |
| 6,7 | `[human select]` ×2 | pause player → "Use this frame"; click object on frame |
| 6,7 | `[model_3 extract]` | `models.segment_object()` (Claude reads the frame image, returns polygon; validated to contain the click, flood-fill fallback) |
| 6,7 | `[tool_5 modify]` | `tools.inpaint_video()` (cv2 Telea, keyframe → end of scene) |
| 7 | `[human select]` | drag a rectangle on the chart still |
| 6,7 | `[tool_6 compose]` | `tools.compose_full_chart()` / `tools.compose_chart_shape()` |
| 8 | `[human select]` / `[human evaluate]` | Gallery tab: pick version, compare beside current, write assessment |

## Open choices (defaults taken)

- Video generation (Vadoo, model_2) unavailable → local procedural renderer; model_2 is Claude writing a structured animation spec.
- Segmentation (model_3) → Claude vision via the CLI `Read` tool on the keyframe PNG.
- Reference videos → locally rendered illustrative clips described in text (no real footage available).
- Layout: three tabs (Script & Demo / Data Chart / Gallery); scene focus panel on the right of tab 1.
- One project at a time, persisted to disk.
