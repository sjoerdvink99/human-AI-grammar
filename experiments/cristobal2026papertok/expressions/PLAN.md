# PLAN — "System X": research paper → short narrated explainer video

The design has no goal, descriptions, representation descriptions, references or images. From the
identifiers I infer: a user uploads a research **paper**; an LLM pipeline mines it for findings,
story ideas and hooks, rates and shortlists hooks, and writes short-video **script options**; the
user picks one, agrees on a **voice style**, and the system splits the script into **scenes**,
synthesises narration (model_3 = text-to-speech), measures its length, generates a matching visual
(model_2 = visual/video generator), and muxes them into **scene clips**. The user can regenerate or
rewrite single scenes, then adds an author **credit scene** and merges everything into a **final video**.

## Stack (repo was empty)

- Backend: Node 20 + Express (TypeScript via `tsx`), file persistence in `data/projects/<id>/`.
- Frontend: React + Vite + TypeScript, plain CSS.
- Media: `ffmpeg-static` (npm) for video, macOS `say` for speech, `rsvg-convert` for SVG→PNG,
  `pdftotext` / `pdftoppm` / `pdfinfo` for paper parsing.
- Models: every model call goes through `server/providers/*.ts`:
  - `llm.ts` `callLLM()` → `claude -p --output-format json` (CLAUDECODE removed) — model_1 and model_2's prompt step
  - `video.ts` `generateVideo()` → model_2: Claude (separate system prompt) writes an SVG keyframe for the visual prompt, rendered and animated (Ken Burns) for exactly the narration duration
  - `tts.ts` `synthesizeSpeech()` → model_3: macOS `say` with voice/rate derived from voice_style
  Each is one function so a real provider (e.g. a TTS or video API) can be swapped in.

## Representations

| id | type | contents | file |
|---|---|---|---|
| paper | `{title, text, pdfPath?}` | uploaded PDF (or pasted text) | server/types.ts, server/tools/paper.ts |
| findings | `string[]` | 4–8 key findings | server/pipeline.ts |
| story_ideas | `string[]` | 3–5 narrative angles | server/pipeline.ts |
| hooks | `string[]` | 6–10 opening lines (≤ 25 words) | server/pipeline.ts |
| hook_ratings | `number[]` (1–10, aligned with hooks) | bars next to each hook | server/pipeline.ts |
| shortlisted_hooks | `string[]` (3) | top hooks chosen by the model | server/pipeline.ts |
| script_options / script | `ScriptRecord {title, hook, body, closing, target_seconds}` | cards; selected one editable form | server/types.ts |
| baseline_voice_style | string | deterministic template from script | server/tools/voice.ts |
| tone_suggestion | string | model suggestion | server/pipeline.ts |
| tone_preference | string | user text (prefilled with suggestion) | client VoicePanel |
| voice_style | string | final narration style instruction | server/pipeline.ts |
| scene_scripts | `SceneScript[] {text, versions[]}` | narration per scene | server/types.ts |
| visual_prompts | `string[]` aligned with scenes (versioned) | image/video prompt per scene | server/types.ts |
| scene_request | `"all" \| sceneIndex` | which scenes to render | client ScenesPanel |
| scene_audio / scene_durations | wav paths / seconds | per scene | server/tools/media.ts |
| scene_videos | silent mp4 paths | per scene | server/providers/video.ts |
| scene_clips | mp4 (audio+video) per scene, with history | grid of players | server/tools/media.ts |
| scene_selection | scene index | clicked clip card | client |
| regeneration_request | `"new_take" \| "more_energetic" \| "calmer"` | buttons | client |
| replacement_* / revised_* | single-scene audio, duration, video, clip | | server/pipeline.ts |
| paper_screenshot | png (page 1 of PDF, or rendered title card) | server/tools/paper.ts |
| paper_authors | `string[]` | pdfinfo Author or first-page heuristic | server/tools/paper.ts |
| credit_text | string (v1 composed, v2 edited) | textarea | server/tools/credits.ts |
| credit_scene | png | preview | server/tools/credits.ts |
| approved_clips | scene indices checked | checkboxes | client |
| merge_request | `"credit_end" \| "credit_start"` | buttons | client |
| credit_clip | mp4 (4 s still + silence) | server/tools/media.ts |
| final_video | mp4 | player + download | server/tools/media.ts |

## Transformations (process order)

| # | actor op | implementation |
|---|---|---|
| P1 | model_1 extract findings | `POST /api/projects/:id/findings` → `extractFindings` |
| P1 | model_1 generate story ideas | `/story-ideas` → `generateStoryIdeas` |
| P1 | model_1 generate hooks | `/hooks` → `generateHooks` |
| P1 | model_1 evaluate hooks | `/hook-ratings` → `rateHooks` |
| P1 | model_1 select shortlist | `/shortlist` → `shortlistHooks` |
| P1 | model_1 generate script options | `/script-options` → `generateScriptOptions` |
| P2 | human select script | ScriptOptions card "Use this script" → `/script/select` |
| P2 | tool_1 compose baseline style | `composeBaselineVoiceStyle` (in `/script/select`) |
| P2 | model_1 generate tone suggestion | `/tone-suggestion` → `suggestTone` |
| P2 | human specify tone preference | VoicePanel textarea |
| P2 | model_1 compose voice style | `/voice-style` → `composeVoiceStyle` |
| P3 | human modify script | ScriptEditor form → `PUT /script` |
| P4 | model_1 decompose | `/scenes` → `decomposeScript` |
| P4 | model_1 generate visual prompts | `/visual-prompts` → `generateVisualPrompts` |
| P4 | human specify scene_request | ScenesPanel "Render all / Render scene N" |
| P4 | model_3 → tool_1 extract → model_2 → tool_2 compose | `/render` → `renderScene` (tts → wavDuration → generateVideo → muxClip) |
| P5 | human select scene, specify regeneration | clip card click + regenerate buttons → `/scenes/:i/regenerate` |
| P5 | model_3, tool_1, model_2, tool_2, tool_1 modify | `renderScene` + `replaceClip` (old clip kept in history) |
| P6 | human modify scene script | inline edit → `/scenes/:i/revise` |
| P6 | model_1 generate visual prompt, model_3, tool_1, model_2, tool_2, tool_1 modify | `reviseScene` |
| P7 | tool_1 extract screenshot+authors | `/credits/extract` |
| P7 | tool_1 compose credit text | `composeCreditText` |
| P7 | human modify credit text | textarea |
| P7 | tool_1 compose credit scene | `/credits/scene` → `composeCreditScene` (SVG → PNG) |
| P7 | human select approved clips, specify merge request | checkboxes + buttons |
| P7 | tool_2 translate, tool_2 compose | `/final` → `stillToClip`, `concatClips` |

## Open choices (defaults taken)
- Provider: local Claude CLI; TTS: macOS `say`; video: Claude-authored SVG keyframe + Ken Burns animation.
- Persistence: JSON + media files per project on disk.
- Layout: single page, vertical stepper of sections (1 Paper & ideas → 2 Script → 3 Voice → 4 Scenes → 5 Credits & export).
- Format: vertical 720×1280, 25 fps (short-form video).
