# Songwriting Companion (System X)

A web app implementing `design.json`: a framework-guided conversation turns into lyrics,
the lyrics into a song with a synced visualization, and the song into reflection, with the option
to regenerate the music.

## Run

Requirements: Node 20+, macOS (uses `say` and `afconvert` for vocals), the `claude` CLI logged in.

```bash
npm install
npm run dev          # API on :3001, UI on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:3001
npm run typecheck && npm test
```

Session state is stored in `data/session.json`, audio in `data/audio/`. "New session" in the left
rail clears it. Every model step goes through `callModel()` in `server/llm.ts`, which runs
`claude -p --output-format json --json-schema …` with `CLAUDECODE` removed. Set `CLAUDE_MODEL` to
pick a model, or call `setProvider()` to use another backend.

## Design → code

| Process | Step | Code |
|---|---|---|
| 1 | `therapy_framework_1` | `server/framework.ts` |
| 1 | `[model_1 extract]` → `required_variables_1` | `extractRequiredVariables`, `server/steps.ts` |
| 1 | `[tool_1 evaluate]` → `step_status_1` | `evaluateStep`, `server/tools/evaluateStep.ts` |
| 1 | `[model_1 generate]~` → `question_1` | `generateQuestion`, `server/steps.ts` |
| 1 | `[human specify]` → back to `chat_history_1` (loop) | `TalkStage.tsx` → `POST /api/p1/answer` (`p1Round` in `server/index.ts`) |
| 2 | `[model_1 generate]~` → `lyric_questions_1` | `generateLyricQuestions` → `POST /api/p2/questions` |
| 2 | `[human specify]` → `lyric_inputs_1` | `LyricsStage.tsx` question form → `POST /api/p2/answers` |
| 2 | `[model_1 extract]` → `song_concept_1` + `lyric_elements_1` | `extractSongConcept` |
| 2 | `[model_1 generate]~` → `lyrics_1` | `generateLyrics` |
| 2 | `[human evaluate]` → `lyrics_feedback_1` | `LyricsStage.tsx` feedback box → `POST /api/p2/feedback` |
| 2 | `[model_1 modify]~` → `lyrics_1` (loop until approved) | `reviseLyrics`; approval: `POST /api/p2/approve` |
| 3 | `[model_1 generate]~` → `music_guidance_1` | `generateMusicGuidance` → `POST /api/p3/guidance` |
| 3 | `[human specify]` → `music_attributes_1` | `AttributesForm.tsx` in `MusicStage.tsx` → `POST /api/p3/song` |
| 3, 5 | `[model_1 translate]~` → `style_prompt_n` | `translateToStylePrompt` (called from `server/songPipeline.ts`) |
| 3, 5 | `[model_2 generate]~` → `song_n` | `generateSong`, `server/music/generateSong.ts` (composer model + `synth.ts` + `vocals.ts`) |
| 3, 5 | `[tool_2 extract]` → `predicted_transcript_n` + `audio_features_n` | `server/tools/transcribe.ts`, `server/tools/audioFeatures.ts` |
| 3, 5 | `[tool_3 match]` → `timed_lyrics_n` | `alignLyrics`, `server/tools/alignLyrics.ts` |
| 3, 5 | `[tool_4 extract]` → `beat_features_n` | `extractBeats`, `server/tools/beats.ts` |
| 3, 5 | `[tool_5 translate]` → `music_visualization_n` | `renderVisualization`, `server/tools/visualize.ts`; playhead in `SongView.tsx` |
| 4 | `[model_1 generate]~` → `review_question_1` | `generateReviewQuestion` → `POST /api/p4/review-question` |
| 4 | `[human evaluate]` → `song_feedback_1` | `ReflectStage.tsx` → `POST /api/p4/feedback` |
| 4 | `[model_1 generate]~` → `reflection_question_1` | `generateReflectionQuestion` (same request) |
| 4 | `[human specify]` → `reflection_1` | `ReflectStage.tsx` → `POST /api/p4/reflection` |
| 4 | `[model_1 generate]~` → `supportive_response_1` | `generateSupportiveResponse` |
| 5 | `[human modify]` → `music_attributes_2` | "Change the music" panel in `ReflectStage.tsx` (pre-filled with the last attributes, shows `song_feedback`) → `POST /api/p3/song` |

All song versions are kept (`session.songs`) and can be compared in the UI.
