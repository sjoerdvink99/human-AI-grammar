# Paper → Short (System X)

Turns an uploaded academic PDF into a ~60-second vertical science video: hook-and-script options, a voiceover style, narrated and captioned scenes that can be regenerated one by one, an editable credit screen, and a final MP4. Built from `design.json` (Human-AI grammar design, 7 processes).

## Run

Requirements: Node 20+, macOS (`say` for text-to-speech), poppler (`pdftotext`, `pdftoppm`, `pdfinfo`), and a logged-in Claude Code CLI (`claude`). ffmpeg ships with the `ffmpeg-static` npm package.

```bash
npm install
npm run dev        # API on :3001 + Vite on :5173 → open http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:3001
npm run typecheck && npm test
```

Environment: `CLAUDE_MODEL` (optional `--model` for the CLI), `MODEL_CONCURRENCY` (default 4), `CLAUDE_BIN`, `DATA_DIR` (default `data/projects`), `CAPTION_FONT`, `PORT`.

All model calls go through `callModel()` in `server/model.ts`, which runs `claude -p --output-format json --json-schema …` with `CLAUDECODE` removed from the environment. Replace that function to switch providers.

## Design → code

| Process | Transformation | Code |
|---|---|---|
| 1 Generate hooks and scripts | upload `paper_1` | `POST /api/projects` → `readPaper` (server/tools.ts), `web/src/steps/Upload.tsx` |
| | `[model_1 extract]` findings | `extractFindings` (server/pipeline.ts) |
| | `[model_1 generate]~` story_ideas | `generateStoryIdeas` |
| | `[model_1 generate]~` hooks | `generateHooks` |
| | `[model_1 evaluate]` hook_ratings | `rateHooks` |
| | `[model_1 select]` shortlisted_hooks | `shortlistHooks` |
| | `[model_1 generate]~` script_options (4 × 8 scenes) | `generateScriptOptions`; shown in `ScriptOptions.tsx` |
| 2 Choose script and voiceover style | `[human select]` script | "Use this script" in `ScriptOptions.tsx` → `selectScript` |
| | `[tool_1 compose]` baseline_voice_style | `composeBaselineVoiceStyle` (server/tools.ts) |
| | `[model_1 generate]~` tone_suggestion | `suggestTone` |
| | `[human specify]` tone_preference | `VoiceStyle.tsx` (accept / write your own) |
| | `[model_1 compose]~` voice_style | `composeVoiceStyle` |
| 3 Refine the script | `[human modify]` script | `ScriptEditor.tsx`, `PUT /script`, `POST /script/revert` |
| 4 Prepare storyboard and clips | `[model_1 decompose]` scene_scripts | `decomposeScript` (auto-triggered after voice style is set) |
| | `[model_1 generate]~` visual_prompts | `generateVisualPrompts` |
| | `[human specify]` scene_request (all / one) | "Generate all scenes" / "Generate scene" in `Storyboard.tsx` → `generateScenes` |
| | `[model_3 generate]~` scene_audio | `synthesizeSpeech` (server/media.ts) |
| | `[tool_1 extract]` scene_durations | `measureDuration` |
| | `[model_2 generate]~` scene_videos | `generateSceneVideo` |
| | `[tool_2 compose]` scene_clips | `composeClip` |
| 5 Regenerate a scene | `[human select]` scene_selection + `[human specify]` regeneration_request | scene card selection + "↻ Regenerate" → `regenerateScene` |
| | model_3 → tool_1 → model_2 → tool_2 | `produceScene` (shared chain) |
| | `[tool_1 modify]` scene_clips | `replaceClip` (earlier versions kept, restorable via `restoreClip`) |
| 6 Revise a storyboard scene | `[human modify]` scene_scripts_2 | narration textarea + "Save & regenerate" → `reviseScene` |
| | `[model_1 generate]~` visual_prompts_2 | `regenerateVisualPrompt` |
| | model_3 → tool_1 → model_2 → tool_2 → tool_1 modify | `produceScene` + `replaceClip` |
| 7 Add credits and merge | `[tool_1 extract]` paper_screenshot, paper_authors | `extractScreenshot`, `extractAuthors` (auto-triggered when all clips exist) |
| | `[tool_1 compose]` credit_text | `composeCreditText` |
| | `[human modify]` credit_text_2 | `Credits.tsx` → `updateCreditText` |
| | `[tool_1 compose]` credit_scene | `renderCreditScene` |
| | `[human select]` approved_clips | approval checkboxes in `Credits.tsx` |
| | `[human specify]` merge_request | "Merge final video" → `mergeFinal` |
| | `[tool_2 translate]` credit_clip | `stillToClip` |
| | `[tool_2 compose]` final_video | `concatClips` |
