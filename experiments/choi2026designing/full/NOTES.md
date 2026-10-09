# NOTES — decisions the design did not determine

The design (`design.json`) fixes the five processes, their representations, the actors, and the triggers in each process description. It has no references and no images. Everything below is my own choice.

## Stack and infrastructure

| Decision | Choice |
|---|---|
| Stack | Node 20 + Express 5 (TypeScript run with `tsx`) backend; Vite + React 19 + TypeScript frontend; zod 4 for schemas and validation; vitest for tests. No other runtime libraries. |
| Model provider | Claude Code CLI, called once per model operation from `callModel()` in `server/llm.ts`: `claude -p --output-format json --json-schema <schema> --system-prompt … --tools "" --no-session-persistence --model <alias>`. The prompt goes in on stdin, `CLAUDECODE` is removed from the environment, and the cwd is the OS temp dir. The schema comes from the zod schema (`z.toJSONSchema`), and the CLI's `structured_output` is checked again with zod. One automatic retry on failure. 240 s timeout. |
| Model choice | `sonnet` for both model_1 and model_2 by default, chosen for speed. Can be changed with `MODEL_1` / `MODEL_2`. |
| model_1 vs model_2 | These are separate roles with separate system prompts. model_1 is a "songwriting companion trained in music-therapy practice". model_2 is a "music generation model" that composes scores. |
| **model_2 (music generation)** | No audio model was available, so model_2 is Claude writing a full symbolic score as validated JSON: BPM, key, mode, instruments, drum pattern, swing, vocal register and tone, and an arrangement of sections with energy, roman-numeral chords, and one note per sung word (scale degree + beats). A deterministic synthesizer I wrote (`server/music/synth.ts`) renders the score to a 22.05 kHz mono WAV. It has piano, Karplus-Strong guitar, saw pads/strings, bass, FM bells, synthesized drums, and a formant-synthesized "vocal" whose vowel is picked from each word. It does not produce intelligible singing. `generateSong(lyrics, stylePrompt)` is the single boundary to replace with a real text-to-song API. |
| Generator outputs | Besides the mix, `generateSong` writes a separate vocal stem and returns the lyric text the generator says it sang, as many text-to-song services do. |
| Persistence | One JSON file per session in `data/sessions/`, and WAV files in `data/audio/`. The last session id is kept in `localStorage`, and `?session=<id>` opens a specific session. |
| Long-running steps | Each human action is recorded synchronously. The model/tool chain that follows runs as a background job on the server, which sets `session.busy = {op, label}`. The client polls every 1.2 s and shows the running actor and operation as a typing bubble (for example "🎵 Composing and producing your song…"). Failures become `session.error`, shown with a **Retry** button that re-runs only the failed chain. |

## Representations and data formats

| Identifier | Format chosen |
|---|---|
| therapy_framework | Four steps with two required variables each: *Personal experiences* (experience, context), *Emotions* (emotions, current_feeling), *Motivation* (motivation, audience), *Musical preferences* (music_experience, preferred_music). It also holds four principles (warmth, Deaf-aware framing of music, one question at a time, no pressure to disclose) and `maxTurnsPerStep = 4`. |
| chat_history | `{role, text, at}[]` holding only the process-1 conversation. The UI shows a wider feed (`session.feed`) that also contains lyric questions, guidance, review and reflection messages, but those are not part of chat_history. |
| required_variables | A flat `Record<variable, string>` covering all variables in the framework. It is extracted again on every round and merged, so a filled value is never cleared. |
| step_status | `{status: complete\|incomplete, currentStep, completedSteps, missing, allComplete}`. |
| lyric_questions | 3–5 strings. **lyric_inputs** are the answers, stored as "Q: … A: …" text. |
| song_concept | `{title, theme, message, perspective, narrative}`. **lyric_elements**: `{emotions[], scenes[], keywords[], lyric_ideas[]}`. |
| lyrics | Plain text with `[Verse 1]`/`[Chorus]`/`[Verse 2]`/`[Bridge]` header lines. **Enforced in code** (`validateLyrics`): at least two verses, a chorus, a bridge, and 10–40 lines. Output that fails is sent back to the model once with the reason. Every version is kept together with the feedback it received. |
| music_attributes | `{genre, mood, tempo_bpm 60–160, instruments[], vocal, notes}` using fixed vocabularies (9 genres, 8 moods, 7 instruments, 4 voices). Every version is kept. |
| style_prompt | At most 300 characters of comma-separated text. |
| song | `{version, audioUrl, duration, stylePrompt, attributes, …analysis}`. Every version is kept and can be selected. |
| predicted_transcript | `{words: {word,start,end}[]}`. Timings come from voiced segments that energy thresholding finds in the vocal stem. The words come from the generator's lyric sidecar, normalised the way an ASR system would output them (lowercase, no punctuation). The segment count is merged or split until it matches the word count. This stands in for a real "music analysis API" with speech recognition. |
| audio_features | Measured from the mix: per-frame loudness and spectral-centroid brightness (100 ms frames), key and mode via Krumhansl–Kessler profile correlation, overall energy, and average brightness. |
| timed_lyrics | `{lines: {section, text, start, end, words: {word,start,end,matched}[]}[], matchRate}`. Restores the user's spelling and punctuation, one entry per sung occurrence of a line, so repeated choruses appear several times. |
| beat_features | A table of `{index, time, strength, downbeat}` rows plus the tempo. Shown as a scrollable table under "How this version was made". |
| music_visualization | A render spec `{palette, duration, lines, beats, envelope, summary[]}`. Hue comes from the key's position on the circle of fifths. Minor keys are darker. Saturation follows energy. |

## Tool algorithms

- **tool_1**: advances through every step whose variables are all filled (non-empty and not "unknown"). It also advances after 4 user turns in one step, so someone who doesn't want to share is never stuck. This safety valve is my addition.
- **tool_3**: a Needleman–Wunsch-style dynamic program (+2 for an exact match, +1 for close spelling with edit ratio ≤ 0.34, −1 for a gap or mismatch), with extra low-cost "jump" transitions from the end of any lyric line to the start of any line. This handles repeated choruses and skipped sections. Unmatched lyric words get interpolated timings.
- **tool_4**: a log-spectral-flux onset envelope, tempo by autocorrelation with a log-normal prior around 110 BPM, dynamic-programming beat tracking (Ellis-style, tightness 100), and downbeat phase taken from low-band (< 150 Hz) onset energy. All implemented by hand, with no audio library.
- **tool_5**: turns the analysis into the render spec. The canvas drawing runs in the browser.

## Model prompts (summary; full text in `server/process*.ts`, `server/music/generateSong.ts`)

- Shared model_1 system prompt: a warm songwriting companion with music-therapy practice, working with Deaf/HoH people, who never assumes music is heard the way hearing people hear it, and who answers in JSON only.
- extract: fill every framework variable from what the person said, using their words, with "" for anything not yet shared. Never invent.
- question: acknowledge briefly, then ask one open, supportive question aimed at the missing variables, in at most 3 sentences. The first turn includes a greeting and an explanation.
- lyric questions: 4 questions about emotions, a concrete scene (seen or felt, not only heard), keywords or signs, and existing lines.
- lyrics: use the concept and elements, prefer visual and physical imagery over sound imagery, follow a fixed header format, 4-line verses and chorus, singable lines.
- music guidance: explain genre, mood, tempo, instruments and voice in non-auditory terms (tempo as a heartbeat, low instruments as vibration), suggest 1–2 options, under 180 words.
- style prompt: concise comma-separated text including every attribute and the person's notes.
- model_2: compose a full score in play order, repeat the chorus, one note per word with the exact lyric word, lines of 6–7.5 beats (two bars), instruments only from the list.
- review, reflection, and supportive response follow the process-4 description. The supportive response is told not to give clinical advice.

## Layout, styling, interaction

- Before a session starts, a welcome page explains the four stages. After that the layout has two columns: the **conversation** on the left (chat bubbles, typing/progress bubble, composer or lyric-question form) and the **workspace** on the right (framework progress cards, song concept and lyrics with version tabs, music form, song player and visualization). The columns stack on narrow screens.
- A phase pill in the top bar shows the current stage ("1 · Talking together" … "5 · Changing the music").
- Lyric review offers three buttons: "I'm happy with these lyrics", "Request changes" (needs feedback text), and "Write a fresh version" (regenerate).
- The music form uses chip toggles for genre, mood, instruments and voice, and a tempo slider with a **visually pulsing dot at the chosen BPM** so tempo can be seen. The model's guidance appears above the form. In process 5 the form is prefilled with the previous attributes and shows the user's song feedback.
- Visualization: a 16:9 canvas that follows the `<audio>` element's time. It shows karaoke lyrics (the current word lifts and turns the accent colour, with an underline progress bar), the next line dimmed, the section label, a central pulse that scales with loudness and beats (stronger on downbeats), expanding rings per beat, a 1-2-3-4 beat counter, and a loudness ribbon of the whole song with line markers and a playhead (click to seek). It respects `prefers-reduced-motion`. There is an optional **"Vibrate on beats"** toggle (Vibration API).
- Song review offers "I'm happy with my song" (→ reflection), "I'd like to change the music" (→ process 5), and "Try another take" (regenerates with the same style prompt). There's an optional text field for how it felt.
- Styling: warm off-white background, purple brand colour, orange focus and accent, 17 px base font, large touch targets, visible focus outlines.
- After the supportive response the session ends ("done"). The design gives process 4 no loop, so there is no further reflection round.

## Steps added beyond the design (implementation conveniences)

These don't add new representations. They re-run an existing transformation: "Write a fresh version" re-runs `[model_1 generate]~` for lyrics, "Try another take" re-runs `[model_2 generate]~` with the same style_prompt, and "Retry" re-runs a failed chain. Process 4's `human evaluate` produces a satisfied/not-satisfied decision plus text. The design leaves the branch into process 5 to its descriptions ("If the user requests changes…"), and the satisfied flag is how I implement that branch.

## Verification

- `npm run typecheck` and `npm run build` pass. `npm test` passes 10 tests covering tool_1, lyric validation, tool_2 onset/key detection, tool_3 with repeated choruses and recognition errors, tool_4 tempo/beats, and tool_5.
- `scripts/e2e.mjs` ran a full session against the running server with real Claude calls: 4 conversation rounds → lyric questions → concept → lyrics v1 → feedback → v2 → accept → guidance → song 1 (170 s, 92 BPM detected for 92 requested, alignment match rate 1.0) → "want changes" → revision → song 2 (118 BPM requested, 117.5 detected) → satisfied → reflection question → reflection → supportive response. Every transformation in all five processes ran.
- Headless-Chromium screenshots of the conversation, music form and song visualization showed no page errors. One React bug (an effect returning `scrollIntoView`'s promise) was found and fixed this way.

## Did the design remind me of a specific published system?

Yes, in a general way, but I can't name one paper with confidence. The design closely matches a line of recent HCI work (around CHI/ASSETS 2024–2025) on **LLM-supported therapeutic songwriting for Deaf and Hard-of-Hearing people**. Those systems combine a GPT-style conversational agent that follows a music-therapy songwriting protocol, a commercial text-to-song generator (the usual choice is **Suno**), and lyric/beat visualization for DHH listeners. I recall such a system existing, but not its exact name, authors or details. I did not look it up, per the instructions.

Choices that came from that background knowledge or general domain knowledge rather than from the design:

- **Treating model_2 as a Suno-like text-to-song service** that takes lyrics plus a short style prompt and returns a song with vocals, a vocal stem, and its own lyric sidecar. The idea that tool_2 is a hosted "music analysis API" returning word-timed transcripts (so lyrics must be re-aligned, which is why tool_3 exists) also comes from how such pipelines usually work (ASR on generated vocals, then alignment to the true lyrics).
- **The style prompt as short comma-separated tags** (genre, mood, BPM, instruments, vocal) is the Suno prompt convention.
- **Framework steps** (experience → emotions → motivation → musical preferences) follow the design's own list. The idea of required variables per step and moving on once they are filled is the design's. The "safety valve" after 4 turns and the principles about not pressuring disclosure come from general therapeutic-conversation practice.
- **Deaf-aware framing** (music as vibration, visuals and signing, explaining tempo as a heartbeat, the optional vibration-on-beat toggle, the visual tempo pulse) comes from general knowledge of DHH music-accessibility research. The design only says the system "visualizes music".
- **MIR algorithms**: Ellis dynamic-programming beat tracking, spectral-flux onsets, and Krumhansl–Kessler key profiles are standard techniques (as in librosa). I chose them because the design names a "beat analysis library". I implemented them myself.

Everything else (the symbolic-score-plus-synth stand-in for music generation, the jump-augmented alignment, the visual design, the session/job architecture) is my own choice for this build.
