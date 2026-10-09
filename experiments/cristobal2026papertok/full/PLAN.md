# PLAN — System X (PDF → short science video)

Design: `design.json` (7 processes, no references, no images).
Plan accepted with my own recommended defaults (controlled experiment: no confirmation round).

## Stack
- Backend: Node 20 + Express, TypeScript run with `tsx`. Project state as JSON on disk (`data/projects/<id>/project.json`) plus media files next to it.
- Frontend: React + Vite + TypeScript, single page with a step-by-step workspace. Polls project state while background jobs run.
- Model provider: one function `callModel()` in `server/model.ts` that runs `claude -p --output-format json --json-schema …` with `CLAUDECODE` removed from the environment.
- PDF: `pdftotext` / `pdftoppm` / `pdfinfo` (poppler). Video: `ffmpeg-static`. SVG → PNG: `@resvg/resvg-js`. TTS: macOS `say`.

## Representations

| id | type | contents | file |
|---|---|---|---|
| paper | `{title, text, pdfPath}` | uploaded PDF and its extracted text | server/types.ts, server/tools.ts |
| findings | `string[]` | concrete findings | server/types.ts |
| story_ideas | `string[]` | ways to tell the story | 〃 |
| hooks | `{id,text}[]` | opening lines | 〃 |
| hook_ratings | `{hookId,score 1-10,reason}[]` | engagement scores shown next to hooks | 〃 |
| shortlisted_hooks | `string[]` hook ids | best hooks (model choice) | 〃 |
| script_options | `ScriptRecord[]` (exactly 4) | `{hook, title, scenes: string[8]}` | 〃 |
| script | `ScriptRecord` | chosen + editable | 〃 |
| baseline_voice_style | string | fixed default, fast-speaking | server/pipeline.ts |
| tone_suggestion | string | model suggestion | 〃 |
| tone_preference | string | accepted or user-written | 〃 |
| voice_style | string | merged final narration instruction | 〃 |
| scene_scripts | `Scene.script` ×8 | narration per scene (v1→v2 on edit) | 〃 |
| visual_prompts | `Scene.visualPrompt` ×8 | visual description per scene | 〃 |
| scene_request / regeneration_request / merge_request | button actions (categorical: all / one) | HTTP endpoints | server/index.ts |
| scene_audio / replacement_audio / revised_audio | `.aiff/.m4a` per scene | narration | server/media.ts |
| scene_durations / replacement_duration / revised_duration | number (s) | measured audio length | 〃 |
| scene_videos / replacement_video / revised_video | silent `.mp4` | SVG keyframes from model_2 animated | 〃 |
| scene_clips / replacement_clip / revised_clip | `.mp4` with audio + captions; history kept per scene | 〃 |
| scene_selection | scene index | UI selection | web/ |
| paper_screenshot | `.png` first page | server/tools.ts |
| paper_authors | `string[]` | pdfinfo / first-page heuristic | 〃 |
| credit_text | string (editable, v1→v2) | attribution | 〃 |
| credit_scene | `.png` | screenshot + attribution | server/media.ts |
| approved_clips | scene index set | checkboxes | web/ |
| credit_clip | `.mp4` | still → 4 s clip | server/media.ts |
| final_video | `.mp4` | concatenation | 〃 |

## Transformations

| # | actor op | function | file |
|---|---|---|---|
| P1 | tool (upload) → model_1 extract | `extractFindings` | server/pipeline.ts |
| | model_1 generate~ | `generateStoryIdeas` | 〃 |
| | model_1 generate~ | `generateHooks` | 〃 |
| | model_1 evaluate | `rateHooks` | 〃 |
| | model_1 select | `shortlistHooks` | 〃 |
| | model_1 generate~ | `generateScriptOptions` | 〃 |
| P2 | human select | ScriptOptions cards | web/src/steps/ScriptOptions.tsx |
| | tool_1 compose | `composeBaselineVoiceStyle` | server/pipeline.ts |
| | model_1 generate~ | `suggestTone` | 〃 |
| | human specify | VoiceStyle panel | web/src/steps/VoiceStyle.tsx |
| | model_1 compose~ | `composeVoiceStyle` | server/pipeline.ts |
| P3 | human modify | ScriptEditor | web/src/steps/ScriptEditor.tsx |
| P4 | model_1 decompose | `decomposeScript` | server/pipeline.ts |
| | model_1 generate~ | `generateVisualPrompts` | 〃 |
| | human specify | "Generate all" / "Generate scene" | web/src/steps/Storyboard.tsx |
| | model_3 generate~ | `synthesizeSpeech` | server/media.ts |
| | tool_1 extract | `measureDuration` | 〃 |
| | model_2 generate~ | `generateSceneVideo` | 〃 |
| | tool_2 compose | `composeClip` | 〃 |
| P5 | human select + specify | scene card "Regenerate" | Storyboard.tsx |
| | model_3 → tool_1 → model_2 → tool_2 → tool_1 modify | `produceScene` + `replaceClip` | server/pipeline.ts |
| P6 | human modify | scene script editor | Storyboard.tsx |
| | model_1 generate~ | `regenerateVisualPrompt` | server/pipeline.ts |
| | model_3 → tool_1 → model_2 → tool_2 → tool_1 modify | `produceScene` + `replaceClip` | 〃 |
| P7 | tool_1 extract | `extractScreenshot`, `extractAuthors` | server/tools.ts |
| | tool_1 compose | `composeCreditText` | 〃 |
| | human modify | credit editor | web/src/steps/Credits.tsx |
| | tool_1 compose | `renderCreditScene` | server/media.ts |
| | human select | approve checkboxes | Credits.tsx |
| | human specify | "Merge final video" | Credits.tsx |
| | tool_2 translate | `stillToClip` | server/media.ts |
| | tool_2 compose | `concatClips` | server/media.ts |

## Open choices and defaults
- Provider: Claude Code CLI behind `callModel()`; video model (model_2) = Claude writes SVG keyframes, rendered and animated (slow zoom) by ffmpeg; TTS (model_3) = macOS `say`, with voice/rate chosen from voice_style by one cached Claude call. Both behind provider functions.
- Persistence: JSON files on disk.
- Layout: left step rail (Paper → Scripts → Voice → Storyboard → Credits & Export), main panel; 9:16 video previews.
- Earlier clip versions per scene kept and restorable (loops in P5/P6).
