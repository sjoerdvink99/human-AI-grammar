# PLAN — System X (therapeutic songwriting for Deaf and Hard-of-Hearing users)

The design has 5 processes, no references and no images. Plan was written and the recommended defaults were taken without waiting for confirmation (controlled experiment).

## Stack (empty repo → minimal stack)

- **Backend**: Node 20 + Express, TypeScript run with `tsx`. Session state as JSON files in `data/sessions/`, audio in `data/audio/`.
- **Frontend**: Vite + React + TypeScript, one page. Plain CSS.
- **Validation**: zod 4 (schemas also converted to JSON Schema for the model's structured output).
- **Models**: every model call goes through one function `callModel()` in `server/llm.ts`, which runs `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from the environment. Swap the provider by changing that one function.
- **model_2 (music generation)**: there's no audio model, so model_2 is a *separate* Claude configuration that writes a symbolic score (tempo, key, chords, one sung note per lyric word, arrangement). A deterministic synthesizer (`server/music/synth.ts`) then renders it to a WAV with a formant-synthesized "vocal" line. `generateSong(lyrics, stylePrompt)` is the single model_2 boundary.
- **Tests**: vitest for the deterministic tools (tool_1, tool_3, tool_4, synth + tool_2).

## Representations

| Identifier | Type | Contents | File |
|---|---|---|---|
| therapy_framework | `TherapyFramework` record (instruction) | 4 steps (experiences, emotions, motivation, musical preferences), each with required variables + guidance | `server/framework.ts` |
| chat_history | `ChatTurn[]` (language) | the therapeutic conversation (assistant questions + user answers) | `server/types.ts` |
| required_variables | `Record<string,string>` (record) | values gathered for every framework variable | `server/types.ts` |
| step_status | `"incomplete" \| "complete"` + current step index (categorical) | output of tool_1 | `server/tools/stepChecker.ts` |
| question | string | next supportive question (also appended to chat_history) | `server/process1.ts` |
| lyric_questions | `string[]` | 3–5 questions about the song | `server/process2.ts` |
| lyric_inputs | string | user's answers joined as Q/A text | `server/process2.ts` |
| song_concept | `{title, theme, message, perspective, narrative}` | | `server/types.ts` |
| lyric_elements | `{emotions[], scenes[], keywords[], lyric_ideas[]}` | | `server/types.ts` |
| lyrics | string with `[Verse 1]`, `[Chorus]`, `[Verse 2]`, `[Bridge]` headers; all versions kept | validated: must contain verse, chorus, bridge | `server/types.ts` |
| lyrics_feedback | string | | |
| music_guidance | string | explanations + suggestions | `server/process3.ts` |
| music_attributes | `{genre, mood, tempo_bpm, instruments[], vocal, notes}`; versions kept | form | `web/src/components/MusicAttributesForm.tsx` |
| style_prompt | string (≤ 300 chars) | | `server/process3.ts` |
| song | `{version, audioUrl, duration, stylePrompt, attributes}`; all versions kept | WAV | `server/music/` |
| predicted_transcript | `{words: {word, start, end}[]}` | | `server/tools/analysis.ts` |
| audio_features | `{duration, key, mode, loudness[], brightness[], energy, frameHop}` | | `server/tools/analysis.ts` |
| timed_lyrics | `{lines: {section, text, start, end, words: {word,start,end}[]}[]}` | | `server/tools/align.ts` |
| beat_features | rows `{index, time, strength, downbeat}` + tempo | table | `server/tools/beats.ts` |
| music_visualization | render spec (palette, lines, beats, envelope) drawn on an animated canvas | | `server/tools/visualize.ts`, `web/src/components/MusicVisualization.tsx` |
| review_question, song_feedback, reflection_question, reflection, supportive_response | strings | | `server/process4.ts` |

## Transformations

| Process | Actor op | Function | File |
|---|---|---|---|
| 1 | model_1 extract | `extractRequiredVariables` | `server/process1.ts` |
| 1 | tool_1 evaluate | `evaluateStepStatus` | `server/tools/stepChecker.ts` |
| 1 | model_1 generate~ | `generateQuestion` | `server/process1.ts` |
| 1 | human specify | chat input → `POST /api/sessions/:id/therapy/answer` | `web/src/components/ChatPanel.tsx` |
| 2 | model_1 generate~ | `generateLyricQuestions` | `server/process2.ts` |
| 2 | human specify | `LyricQuestionsForm` | web |
| 2 | model_1 extract | `extractConceptAndElements` | `server/process2.ts` |
| 2 | model_1 generate~ | `generateLyrics` | `server/process2.ts` |
| 2 | human evaluate | `LyricsPanel` accept / request changes | web |
| 2 | model_1 modify~ | `reviseLyrics` (loop, versions kept) | `server/process2.ts` |
| 3 | model_1 generate~ | `generateMusicGuidance` | `server/process3.ts` |
| 3 | human specify | `MusicAttributesForm` | web |
| 3/5 | model_1 translate~ | `translateToStylePrompt` | `server/process3.ts` |
| 3/5 | model_2 generate~ | `generateSong` (score by model_2 + synth) | `server/music/generateSong.ts` |
| 3/5 | tool_2 extract | `analyzeMusic` | `server/tools/analysis.ts` |
| 3/5 | tool_3 match | `alignLyrics` (Needleman–Wunsch) | `server/tools/align.ts` |
| 3/5 | tool_4 extract | `extractBeats` (onset envelope + autocorrelation + DP beat tracking) | `server/tools/beats.ts` |
| 3/5 | tool_5 translate | `renderVisualization` | `server/tools/visualize.ts` |
| 4 | model_1 generate~ | `generateReviewQuestion` | `server/process4.ts` |
| 4 | human evaluate | `SongReview` (satisfied / want changes + text) | web |
| 4 | model_1 generate~ | `generateReflectionQuestion` | `server/process4.ts` |
| 4 | human specify | reflection text | web |
| 4 | model_1 generate~ | `generateSupportiveResponse` | `server/process4.ts` |
| 5 | human modify | `MusicAttributesForm` prefilled with previous attributes + feedback shown | web |

## Flow

One session moves through phases: `therapy` (P1 loop) → `lyrics` (P2) → `music` (P3) → `review` (P4) → either `reflection` (P4 continued) or `revision` (P5 → back to `review` with song_n+1) → `done`.
Long steps run in the background on the server; the client polls the session and shows which actor/op is running (`~` loading states). Errors are shown with a Retry button.

## Open choices (defaults taken)

- Provider: Claude Code CLI (`sonnet` for both model roles by default, env `MODEL_1`/`MODEL_2`).
- Persistence: JSON files per session.
- Layout: two columns — conversation on the left, workspace (framework progress, lyrics, music, visualization) on the right.
- Accessibility (DHH audience): every audio event is also visual (karaoke lyrics, beat pulses, loudness ribbon), optional phone vibration on beats.
