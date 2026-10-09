# PLAN — System X (therapeutic songwriting)

The design has no goal, description, representation descriptions, references or images. From the
identifiers (therapy_framework, required_variables, lyric_questions, song_concept, music_attributes,
style_prompt, song, timed_lyrics, reflection, supportive_response) I read it as a guided
**music-therapy songwriting companion**: a framework-driven conversation (P1) gathers what the
client is going through, the client co-writes lyrics (P2), turns them into a song (P3), reflects on
the song (P4), and may regenerate the music with changed attributes (P5).

## Stack (recommended default, taken)

- Backend: Node 20 + Express + TypeScript (run with `tsx`), zod for validating model outputs.
- Frontend: React + Vite + TypeScript, plain CSS.
- Models: one function `callModel()` in `server/llm.ts` that shells out to
  `claude -p --output-format json --json-schema … --tools ""` with `CLAUDECODE` removed from env.
- Persistence: single session kept in memory and mirrored to `data/session.json`; audio in `data/audio/`.

## Representations

| id | type | contents | file |
|---|---|---|---|
| therapy_framework | `TherapyFramework` record | ordered steps, each with goal + required variables (name, description) | server/framework.ts |
| chat_history | `ChatMessage[]` (language) | turns between companion and client | server/types.ts |
| required_variables | `Record<string,string\|null>` | values extracted from chat for each framework variable | server/types.ts |
| step_status | categorical `'in_progress' \| 'step_complete' \| 'all_complete'` + current step index | server/tools/evaluateStep.ts |
| question | string | next companion question | server/types.ts |
| lyric_questions | string[] rendered as language | 3–4 songwriting prompts | server/types.ts |
| lyric_inputs | string | client's answers (Q/A text) | server/types.ts |
| song_concept | record `{title, theme, emotional_arc, perspective, mood, message}` | server/types.ts |
| lyric_elements | record `{key_phrases[], images[], metaphors[], client_words[]}` | server/types.ts |
| lyrics | string with `[Section]` headers; all revisions kept | server/types.ts |
| lyrics_feedback | string | server/types.ts |
| music_guidance | string | server/types.ts |
| music_attributes (v1, v2…) | record `{genre, mood, tempo_bpm, mode, instruments[], voice, energy}` | server/types.ts |
| style_prompt (v1, v2…) | string | server/types.ts |
| song (v1, v2…) | audio WAV (mix + vocal stem) + composition record | server/music/* |
| predicted_transcript | record: segments/words with times | server/tools/transcribe.ts |
| audio_features | record: duration, tempo, key, loudness, centroid, energy curve | server/tools/audioFeatures.ts |
| timed_lyrics | record: lyric lines with start/end | server/tools/alignLyrics.ts |
| beat_features | table rows `{beat, time, strength, energy}` | server/tools/beats.ts |
| music_visualization | SVG image + playhead overlay | server/tools/visualize.ts, web/src/SongView.tsx |
| review_question, reflection_question, supportive_response | string | server/types.ts |
| song_feedback, reflection | string (human) | server/types.ts |

## Transformations

| process | actor op | function | file |
|---|---|---|---|
| P1 | model_1 extract | `extractRequiredVariables` | server/steps.ts |
| P1 | tool_1 evaluate | `evaluateStep` | server/tools/evaluateStep.ts |
| P1 | model_1 generate~ | `generateQuestion` | server/steps.ts |
| P1 | human specify (loop) | chat input → `POST /api/p1/answer` | web/src/TalkStage.tsx |
| P2 | model_1 generate~ | `generateLyricQuestions` | server/steps.ts |
| P2 | human specify | answers form | web/src/LyricsStage.tsx |
| P2 | model_1 extract | `extractSongConcept` | server/steps.ts |
| P2 | model_1 generate~ | `generateLyrics` | server/steps.ts |
| P2 | human evaluate | feedback box / approve | web/src/LyricsStage.tsx |
| P2 | model_1 modify~ (loop) | `reviseLyrics` | server/steps.ts |
| P3/P5 | model_1 generate~ | `generateMusicGuidance` | server/steps.ts |
| P3/P5 | human specify / modify | attributes form | web/src/MusicStage.tsx |
| P3/P5 | model_1 translate~ | `translateToStylePrompt` | server/steps.ts |
| P3/P5 | model_2 generate~ | `generateSong` (composer model + synth renderer) | server/music/generateSong.ts |
| P3/P5 | tool_2 extract | `transcribe` + `extractAudioFeatures` | server/tools/* |
| P3/P5 | tool_3 match | `alignLyrics` | server/tools/alignLyrics.ts |
| P3/P5 | tool_4 extract | `extractBeats` | server/tools/beats.ts |
| P3/P5 | tool_5 translate | `renderVisualization` | server/tools/visualize.ts |
| P4 | model_1 generate~ | `generateReviewQuestion` | server/steps.ts |
| P4 | human evaluate | feedback box | web/src/ReflectStage.tsx |
| P4 | model_1 generate~ | `generateReflectionQuestion` | server/steps.ts |
| P4 | human specify | reflection box | web/src/ReflectStage.tsx |
| P4 | model_1 generate~ | `generateSupportiveResponse` | server/steps.ts |

## Open choices and defaults taken

- **model_2 (music generation)**: no music API is available. model_2 = Claude CLI with a separate
  "composer" system prompt producing a symbolic composition (key, chords, melody per lyric line,
  drums), rendered deterministically to WAV by an in-process synthesizer; vocals via macOS `say`.
  Behind `generateSong()` so a real text-to-music service can replace it.
- **tool_2 transcript**: no ASR is installed. A `Transcriber` interface; default implementation runs
  voice-activity detection on the vocal stem for timings and uses the vocal engine's sung text.
- Layout: left rail with stage progress + framework variables, main area with the active stage.
- P5 can be repeated; all song versions are kept and switchable for comparison.
- Loops: P1 ends when tool_1 reports `all_complete`; P2 loop ends when the client approves lyrics.
