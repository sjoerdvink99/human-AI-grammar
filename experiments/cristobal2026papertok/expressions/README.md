# Paper → Video

Implementation of the Human-AI grammar design in [`design.json`](design.json) ("System X"): turn a research
paper into a narrated vertical explainer video. See [PLAN.md](PLAN.md) for the plan and [NOTES.md](NOTES.md)
for every decision the design left open.

## Run

Requirements (macOS): Node 20+, the `claude` CLI (logged in), `say` (built in), and poppler + librsvg
(`brew install poppler librsvg`). ffmpeg comes from the `ffmpeg-static` npm package.

```bash
npm install
npm run dev        # API on :3001, UI on http://localhost:5173
npm test           # unit + media pipeline tests
npm run build      # typecheck + production bundle; then `npm start` serves both on :3001
```

Env: `CLAUDE_MODEL` (default `sonnet`), `CLAUDE_BIN`, `RENDER_CONCURRENCY` (default 3), `PORT`, `DATA_DIR`.

## Model providers

All model steps go through one function per modality, so providers can be swapped:

| Design actor | Function | Current provider |
|---|---|---|
| model_1 (language) | `callLLM` in `server/providers/llm.ts` | `claude -p --output-format json`, CLAUDECODE unset |
| model_2 (visual) | `generateVideo` in `server/providers/video.ts` | Claude draws an SVG keyframe (via `callLLM`, own system prompt) → rendered → slow-zoom animation of exact duration |
| model_3 (audio) | `synthesizeSpeech` in `server/providers/tts.ts` | macOS `say`, voice/rate derived from the voice style |

## Design → code

| Process | Transformation | Code |
|---|---|---|
| 1 | `[model_1 extract]` paper → findings | `extractFindings` (`server/pipeline.ts`), `POST /findings` |
| 1 | `[model_1 generate]~` → story_ideas | `generateStoryIdeas`, `POST /story-ideas` |
| 1 | `[model_1 generate]~` → hooks | `generateHooks`, `POST /hooks` |
| 1 | `[model_1 evaluate]` → hook_ratings | `rateHooks`, `POST /hook-ratings` (bars in the Hooks card) |
| 1 | `[model_1 select]` → shortlisted_hooks | `shortlistHooks`, `POST /shortlist` |
| 1 | `[model_1 generate]~` → script_options | `generateScriptOptions`, `POST /script-options` |
| 2 | `[human select]` → script | "Use this script" (`ScriptOptions`, `client/src/panels.tsx`), `POST /script/select` |
| 2 | `[tool_1 compose]` → baseline_voice_style | `composeBaselineVoiceStyle` (`server/tools/voice.ts`) |
| 2 | `[model_1 generate]~` → tone_suggestion | `suggestTone`, `POST /tone-suggestion` |
| 2 | `[human specify]` → tone_preference | `VoicePanel` textarea |
| 2 | `[model_1 compose]~` → voice_style | `composeVoiceStyle`, `POST /voice-style` |
| 3 | `[human modify]` script | `ScriptPanel` form, `PUT /script` |
| 4 | `[model_1 decompose]` → scene_scripts | `decomposeScript`, `POST /scenes` |
| 4 | `[model_1 generate]~` → visual_prompts | `generateVisualPrompts`, `POST /visual-prompts` |
| 4 | `[human specify]` → scene_request | "Render all scenes" / per-scene "Render", `POST /render` |
| 4–6 | `[model_3 generate]~` → audio | `synthesizeSpeech` in `renderScene` |
| 4–6 | `[tool_1 extract]` → duration | `wavDuration` (`server/tools/media.ts`) |
| 4–6 | `[model_2 generate]~` → video | `generateVideo` |
| 4–6 | `[tool_2 compose]` → clip | `muxClip` |
| 5 | `[human select]` → scene_selection | click a scene card (`SceneCard`) |
| 5 | `[human specify]` → regeneration_request | New take / More energetic / Calmer, `POST /scenes/:i/regenerate` |
| 5, 6 | `[tool_1 modify]` replace clip | `renderInBackground` in `server/index.ts` (old clip kept in `clipHistory`, restorable) |
| 6 | `[human modify]` → scene_scripts_2 | "Edit narration", `POST /scenes/:i/revise` |
| 6 | `[model_1 generate]~` → visual_prompts_2 | `regenerateVisualPrompt` |
| 7 | `[tool_1 extract]` → paper_screenshot, paper_authors | `paperScreenshot`, `extractAuthors` (`server/tools/paper.ts`), `POST /credits/extract` |
| 7 | `[tool_1 compose]` → credit_text | `composeCreditText` (`server/tools/credits.ts`) |
| 7 | `[human modify]` → credit_text_2 | Credit text textarea |
| 7 | `[tool_1 compose]` → credit_scene | `composeCreditScene`, `POST /credits/scene` |
| 7 | `[human select]` → approved_clips | clip checkboxes (`CreditsPanel`) |
| 7 | `[human specify]` → merge_request | "Merge · credits first/last" |
| 7 | `[tool_2 translate]` → credit_clip | `stillToClip` |
| 7 | `[tool_2 compose]` → final_video | `concatClips`, `POST /final` |
