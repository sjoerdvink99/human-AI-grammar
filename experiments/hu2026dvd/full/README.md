# System X — ideating opening scenes of data videos

An interactive prototype that helps non-experts ideate the opening scenes of data videos from a topic and selected data facts. Built from the Human-AI grammar design in [`design.json`](design.json). The build plan is in [PLAN.md](PLAN.md) and the decisions the design left open are in [NOTES.md](NOTES.md).

## Run

```bash
./run.sh            # creates .venv on first run, then serves http://localhost:8765
.venv/bin/python -m pytest -q    # tests (model calls stubbed)
```

You need Python 3.11 or newer and the `claude` CLI on `PATH`, logged in. Voiceover uses macOS `say` when it is available; without it, videos are silent. ffmpeg comes bundled through `imageio-ffmpeg`. Use Chrome, Safari or Firefox, because the videos are H.264 MP4.

Every model step goes through one function, `backend/llm.py::call_model`. It runs `claude -p … --output-format json --json-schema …` with `CLAUDECODE` removed from the environment. To use another provider, replace that function. Set `SYSTEMX_MODEL_1_MODEL` and the matching variables for `MODEL_2` and `MODEL_3` to pick a model per role.

## Layout

| Tab | Processes |
| --- | --- |
| **1 · Script & demo** | P1 generate, P2 inspect guidelines, P3 revise & regenerate, P4 single-scene clip |
| **2 · Data chart** | P5 animated chart, P6 replace with complete chart, P7 replace with chart shape |
| **3 · Gallery** | P8 revisit and judge earlier versions |

## Design → code

| Process | Step | Code |
| --- | --- | --- |
| 1 Generate opening script and video demo | `[model_1 generate]~` topic + data_facts + guidelines → scripts | `backend/models.py::generate_scripts` (endpoint `POST /api/scripts/generate`, button *Generate opening scenes*) |
| | `[tool_1 compose]` scripts → video_request | `backend/tools.py::compose_video_request` |
| | `[tool_2 execute]` video_request → video | `backend/video_api.py::execute` (local stand-in for the Vadoo API) → `backend/render.py` |
| | `[tool_7 compose]` → video_versions | `backend/tools.py::gallery_compose` (`POST /api/video/render`) |
| 2 Inspect guidelines and references | `[human select]` scene_focus | click a scene card (`frontend/app.js::selectScene`) |
| | `[tool_3 select]` → guideline_focus + reference_focus | `backend/tools.py::link_guideline` (`GET /api/scenes/{i}/focus`), right-hand panel |
| 3 Revise script and regenerate | `[human evaluate]` assessment | *Your assessment of this design* (`POST /api/assessment`, kind `design`) |
| | `[human modify]` scripts_1 → scripts_2 | editable scene cards (`draft` in `app.js`, badge "edited — not yet rendered") |
| | `[tool_1 compose]` → `[tool_2 execute]` → `[tool_7 compose]`, loop | *Regenerate full demo* (`POST /api/video/render` with `scripts`) |
| 4 Regenerate a single scene clip | `[human select]` clip_scene | *5-s clip* button on a scene |
| | `[tool_1 compose]` → clip_request | `backend/tools.py::compose_clip_request` |
| | `[model_2 generate]~` → clip | `backend/models.py::generate_clip` (`POST /api/clip`) |
| 5 Animated chart from real data | `[human specify]` chart_data + chart_type | paste box + Line/Bar/Pie buttons |
| | `[tool_4 translate]` → animated_chart | `backend/charts.py::parse_table`, `make_spec`, `render_chart_video` (`POST /api/chart`) |
| 6 Replace object with complete chart | `[human select]` keyframe_full | pause player → *Use this frame* (`POST /api/replace/keyframe`, `tools.extract_keyframe`) |
| | `[human select]` object_point_full | click on the frame |
| | `[model_3 extract]` → object_mask_full | `backend/models.py::segment_object` (`POST /api/replace/segment`) |
| | `[tool_5 modify]` → cleaned_video_full | `backend/tools.py::inpaint_video` (`POST /api/replace/inpaint`) |
| | `[tool_6 compose]` → video_with_chart | `backend/tools.py::compose_full_chart` (`POST /api/replace/compose`) |
| 7 Replace object with chart shape | same first four steps, mode `shape` | as above |
| | `[human select]` chart_region | drag a rectangle on the chart (step 4) |
| | `[tool_6 compose]` → video_with_shape | `backend/tools.py::compose_chart_shape` |
| 8 Revisit generated versions | `[human select]` reviewed_video | Gallery card |
| | `[human evaluate]` video_assessment | *Your judgement of this video* (`POST /api/assessment`, kind `review`) |

State is saved to `data/project.json`, and media to `data/media/`. *New project* clears the state.
