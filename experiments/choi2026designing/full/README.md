# Songwriting companion (System X)

A conversational web app that helps Deaf and Hard-of-Hearing people express personal experiences through collaborative songwriting:
a supportive conversation → lyric writing → music generation with animated lyric/beat visualization → reflection, with music revision.
Built from `design.json` (Human-AI grammar design).

## Run

Requirements: Node 20+, and the Claude Code CLI (`claude`) installed and logged in. Every model step runs `claude -p` locally.

```bash
npm install
npm start            # builds the web app and serves everything on http://localhost:3001
# or, for development with hot reload:
npm run dev          # API on :3001, web on http://localhost:5173
```

Optional environment: `MODEL_1` / `MODEL_2` (Claude model alias for the language model and the music model, default `sonnet`), `CLAUDE_BIN`, `PORT`.

Checks: `npm run typecheck`, `npm test` (deterministic tools), `node scripts/e2e.mjs` (drives one full session through all processes against a running server; it makes real model calls), `npx tsx scripts/try-song.ts` (model_2 and the analysis chain only).

## Design → code

Actors: model_1 = language model (`server/llm.ts` → `callModel({role: "model_1"})`), model_2 = music generation model (`server/music/generateSong.ts`), tool_1…tool_5 = deterministic code in `server/tools/`.
Every model call goes through `callModel()` in `server/llm.ts`. Change that one function to switch provider.

| Process | Transformation | Implementation |
|---|---|---|
| 1 Therapeutic conversation | `[model_1 extract]` therapy_framework + chat_history → required_variables | `extractRequiredVariables` · `server/process1.ts` |
| | `[tool_1 evaluate]` → step_status | `evaluateStepStatus` · `server/tools/stepChecker.ts` |
| | `[model_1 generate]~` → question | `generateQuestion` · `server/process1.ts` |
| | `[human specify]` → chat_history (loop) | chat composer · `web/src/components/ChatPanel.tsx` → `POST /therapy/answer` |
| 2 Collaborative lyric writing | `[model_1 generate]~` → lyric_questions | `generateLyricQuestions` · `server/process2.ts` |
| | `[human specify]` → lyric_inputs | `LyricQuestionsForm` · `ChatPanel.tsx` → `POST /lyrics/inputs` |
| | `[model_1 extract]` → song_concept + lyric_elements | `extractConceptAndElements` · `server/process2.ts` |
| | `[model_1 generate]~` → lyrics | `generateLyrics` (+ `validateLyrics`) · `server/process2.ts` |
| | `[human evaluate]` → lyrics_feedback | `LyricsPanel` · `web/src/components/LyricsPanel.tsx` |
| | `[model_1 modify]~` → lyrics (loop, versions kept) | `reviseLyrics` · `server/process2.ts` |
| 3 Music generation and visualization | `[model_1 generate]~` → music_guidance | `generateMusicGuidance` · `server/process3.ts` |
| | `[human specify]` → music_attributes | `MusicAttributesForm` · `web/src/components/MusicAttributesForm.tsx` |
| | `[model_1 translate]~` → style_prompt | `translateToStylePrompt` · `server/process3.ts` |
| | `[model_2 generate]~` → song | `generateSong` (score by model_2, rendered by `server/music/synth.ts`) · `server/music/generateSong.ts` |
| | `[tool_2 extract]` → predicted_transcript + audio_features | `analyzeMusic` · `server/tools/analysis.ts` |
| | `[tool_3 match]` → timed_lyrics | `alignLyrics` · `server/tools/align.ts` |
| | `[tool_4 extract]` → beat_features | `extractBeats` · `server/tools/beats.ts` |
| | `[tool_5 translate]` → music_visualization | `renderVisualization` · `server/tools/visualize.ts`, drawn by `web/src/components/MusicVisualization.tsx` |
| 4 Song discussion and reflection | `[model_1 generate]~` → review_question | `generateReviewQuestion` · `server/process4.ts` |
| | `[human evaluate]` → song_feedback | review controls · `web/src/components/SongPanel.tsx` → `POST /song/feedback` |
| | `[model_1 generate]~` → reflection_question | `generateReflectionQuestion` · `server/process4.ts` |
| | `[human specify]` → reflection | chat composer (reflection phase) → `POST /reflection` |
| | `[model_1 generate]~` → supportive_response | `generateSupportiveResponse` · `server/process4.ts` |
| 5 Music revision | `[human modify]` → music_attributes_2 | `MusicAttributesForm` in revision mode (prefilled, song_feedback shown) |
| | `[model_1 translate]~`, `[model_2 generate]~`, `[tool_2…tool_5]` | the same functions as process 3 (`runSongFromAttributes` · `server/process3.ts`), producing song_2 … |

The therapy framework (steps and required variables) is in `server/framework.ts`; the representation types are in `server/types.ts`. See `PLAN.md` for the plan and `NOTES.md` for every decision the design left open.
