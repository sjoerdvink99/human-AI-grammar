# NOTES: decisions the design did not determine

`design.json` gives five process expressions and nothing else: no goal, description, representation
descriptions, references or images. Everything below was my choice.

## Interpretation and scope
- **Purpose**: from the identifiers I read the system as a therapeutic songwriting companion. A conversation
  structured by a therapy framework gathers material, and the client then writes lyrics, makes a song,
  and reflects on it.
- **Process wiring**: one app with four stages (Talk → Lyrics → Music → Listen & reflect). Process 5
  (change the music) is a panel inside the reflect stage. It appears once `song_feedback` exists, because
  its first state contains `song_feedback_1`.
- **Loop termination**: P1 loops until tool_1 reports `all_complete`. After that a "Start writing the song"
  button appears, and the client can still keep chatting. P2 loops until the client clicks "These feel right"
  (approve). The design has no approve step, so I treated it as the client ending the evaluate/modify loop,
  not as a new transformation.
- **Triggers**: the first P1 question and the music guidance are generated automatically when their stage
  opens. Every other step is triggered by a button.
- **P5 repeatability**: P5 can run any number of times (song_2, song_3, …). Each new song resets the P4
  review so the client can review the new version. All versions are kept and can be compared.
- **P1 first round**: with an empty chat the `[model_1 extract]` call is skipped because there is nothing
  to extract. tool_1 and generate run as usual.

## Representations (contents invented)
- `therapy_framework`: 4 steps (Check in; Explore the experience; Find meaning and strengths; Set the song's
  intention), each with 2 required variables, plus 4 principles (person-centred, one question at a time,
  no diagnosis with a crisis-line referral, strengths-based). Stored as a constant, not editable in the UI.
- `required_variables`: a flat map of variable → short string or null.
- `step_status`: `in_progress | step_complete | all_complete`, plus the current step index and the
  missing variables. `step_complete` means the step advanced in this round.
- `lyric_questions`: 3–5 questions (prompt asks for 4). `lyric_inputs`: the Q/A pairs joined into one text.
- `song_concept`: {title, theme, emotional_arc, perspective, mood, message}.
  `lyric_elements`: {key_phrases, images, metaphors, client_words}.
- `lyrics`: plain text with `[Section]` headers, 4 lines per section. Every draft is kept with the feedback
  that led to the next one.
- `music_attributes`: {genre (7 options), mood (free text), tempo 50–160, major/minor, instruments (6 options),
  voice (5 descriptive options), energy (calm/moderate/driving)}.
- `predicted_transcript`: segments with word timings. `audio_features`: duration, tempo, key, loudness,
  spectral centroid, a 300-point energy curve. `timed_lyrics`: lyric lines with start/end and a match score.
  `beat_features`: rows {beat, time, strength, energy, downbeat}.
- `music_visualization`: a server-generated SVG with the energy envelope, beat ticks (downbeats emphasized),
  and lyric-line bars coloured by section. The client adds a playhead, click-to-seek, and a large
  "now singing" line.

## Model and tool realisation
- **Provider**: Claude Code CLI (`claude -p --output-format json --tools "" --system-prompt … --json-schema …`,
  `CLAUDECODE` removed), behind `callModel()` / `setProvider()` in `server/llm.ts`. Output is validated
  with zod and retried once if invalid.
- **model_1 vs model_2**: the same provider with separate system prompts and schemas. model_1 is the
  companion. model_2 is a "composer".
- **model_2 generate (song audio)**: no text-to-music model was available. model_2 writes a symbolic score
  (key, mode, bpm, voice, instruments, drums, sections with Roman-numeral chords, and scale-degree melodies
  per line). Deterministic code renders it: additive and Karplus–Strong synthesis plus synthesized drums.
  Vocals are spoken with macOS `say` (one voice per descriptive option: Samantha, Daniel, Karen, Moira,
  Ralph) and placed at the start of each 2-bar line. A quiet lead synth plays the melody. **The vocals are
  spoken, not sung.** This is the biggest gap from what the design implies. Swap `generateSong()` for a
  real text-to-music service to close it.
- **tool_2 transcript**: no ASR is installed. The default `Transcriber` measures phrase timing by
  voice-activity detection on the vocal stem, and takes the words from the vocal engine's record of what
  it sang. Word timings are spread across each phrase in proportion to word length. This is a stand-in,
  labelled as one in the UI. A Whisper-style transcriber can be plugged in at `transcribe`.
- **tool_2 audio features**: STFT-based chroma with Krumhansl key profiles, spectral centroid, RMS
  loudness, and tempo from onset autocorrelation with a log-Gaussian prior around 110 bpm.
- **tool_3 match**: word-level Needleman–Wunsch alignment of the lyric words to the transcript words. The
  ends of the transcript are free, so intros and repeats are skipped.
- **tool_4 beats**: spectral-flux onset envelope, global tempo, phase taken from the first 8 beats, then
  beat-by-beat tracking that snaps to onset peaks. Downbeat = the strongest beat position in the bar.
- **Model step "seeing" the song (P4)**: a language model cannot hear audio. `describeSong()` therefore
  gives it the style prompt, measured tempo and key, the energy by thirds, and the section order.
- **Prompts**: all in `server/steps.ts` and `server/music/generateSong.ts`. Shared companion persona:
  warm, no diagnosis, crisis-line referral, never assumes the client's gender. The music-guidance prompt
  is limited to the options the form actually offers.

## Stack, layout, styling
- Node + Express + TypeScript (tsx); React + Vite; zod; no UI library; plain CSS.
- Single-user session persisted to `data/session.json`. Requests run one at a time (409 while busy). The
  UI polls `/api/status` for progress text during long steps.
- Layout: a dark left rail with stage navigation and live framework progress (each required variable and
  its extracted value, plus a step-status pill), and the active stage in the main area. Chat bubbles for
  P1 and P4. Cards for the concept and lyric elements. A serif lyrics sheet with draft tabs. A segmented-toggle
  attributes form. An audio player above the visualization. Technical details (style prompt, features,
  timed-lyrics table, beat table) sit in a collapsible section.
- Palette: warm off-white background with a muted violet accent.

## Verification
- `npm run typecheck`, `npm run build` and `npm test` (4 unit tests for tool_1, tool_2 segmenting, tool_3
  and tool_4) all pass.
- Walked all five processes through the API with real CLI calls. Every transformation ran: P1 reached
  `all_complete` after 4 answers; lyrics were revised once; song_1 (76 bpm, 192 s; measured tempo 76) and
  song_2 via P5 (100 bpm; measured 100); review, reflection and supportive response were produced.
- Not verified: listening to the audio by ear, and a click-through in a real browser. The UI was built and
  served, but I did not drive it with a browser.

## Did the design remind me of a published system?
Yes, partly. The combination of a therapy-framework-driven chatbot, required-variable extraction, lyric
co-writing, a Suno-style text-to-music step driven by a style prompt plus lyrics, and Whisper-style
transcription aligned to lyrics for a synced visualization reminded me of recent HCI work on
LLM-supported **music-therapy songwriting**, such as therapeutic songwriting systems that pair GPT-4 with Suno.
I cannot reliably name a single paper and did not look one up. These choices came from that general
background rather than from the design:
- Reading `style_prompt` + `lyrics` → `song` as a Suno-like "style tags + lyrics" call, which is why
  `translateToStylePrompt` produces a comma-separated descriptor line with no artist names.
- Reading `predicted_transcript` as ASR output (Whisper-like word timestamps) and tool_3 as
  lyric-to-transcript alignment.
- Building the therapy framework around familiar therapeutic-songwriting stages (rapport, exploring the
  experience, meaning and strengths, song intention) and the reflection/supportive close at the end.
Layout, the synthesizer, the VAD transcript stand-in, the visualization design and all prompts are my own.
