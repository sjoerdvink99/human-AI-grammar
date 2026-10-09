# NOTES: decisions the design did not determine

The design gives only the structure of five processes. It has no goal, description, process descriptions, representation descriptions, references or images. Almost everything about meaning was therefore my choice. Each decision is listed below.

## 1. Domain and the meaning of every identifier

- **Domain.** I chose "write and rehearse a speech". I picked it because the audio branch of the design best fits language → audio → (two records) → match → table → chart. That reads as speech synthesis followed by prosody analysis, with words aligned to the audio, a per-word table, and a chart. Working backwards, r10 had to be a script, and P1 and P2 became the steps that produce it.
- **r1** is a brief template: a list of fields, each with label, description and a required flag. It has 7 default fields, 6 of them required, and it can be edited in the UI.
- **r2** is the intake conversation. Each user message, together with the assistant follow-ups it answers, is serialised into one text.
- **r3** is the extracted brief, with one string or null per template field.
- **r4** is `complete` or `incomplete`. The tool also returns the list of missing fields.
- **r5** is a single follow-up question, or a confirmation summary once the brief is complete.
- **r6/r7** are the model's proposed approach and the user's edited version of it. They live in one textarea that starts with r6, with a "Reset to proposal" control.
- **r8** is a style spec (tone, register, audienceLevel, targetWords, mustInclude, avoid). **r9** is an outline (sections, each with title, keyPoints and seconds).
- **r10** is the script. **r11** is the user's free-text critique of it.
- **r12** is delivery advice. **r13** is the voice settings: voice, rate in wpm, pitch (lower/normal/higher), tone, pauses (short/medium/long) and emphasis words. **r14** is a natural-language voice direction.
- **r15** is a WAV file. **r16** is the voiced segments. **r17** is a pitch and loudness contour in 20 ms frames.
- **r18** is word timings. **r19** is a per-word table: start, duration, median pitch, mean loudness and pause after. **r20** is an SVG chart.
- **r21** is the model's delivery analysis. **r22** is the user's own listening feedback. **r23** is coaching tips with one practice exercise.
- **r24/r25** are a question to the coach and its answer. The design's state before r25 contains r24 alone, so the coach prompt includes only the question. The UI says so ("The coach sees only your question").
- **P5.** It starts from a state that includes r22, so the re-take panel unlocks only after the user writes feedback on the current take. It shows that feedback quoted above the voice settings form, which is prefilled with the take's r13 and marks changed fields. Every take is kept (r15_1, r15_2, …) and can be compared side by side.

## 2. Triggers (no process descriptions)

- **P1.** Each "Send" runs one round of the loop. The loop ends when tool_1 returns `complete`, which enables "Continue to script".
- **P2.** Entering step 2 automatically generates r6. "Plan & write script" runs extract and then generate. Each "Revise script" runs one round of the r10 loop, and all versions stay available as v1, v2, … tabs.
- **P3.** Entering step 3 automatically generates r12. "Record take" runs translate → speech → tool_2…tool_5.
- **P4.** r21 is generated automatically when a take is opened. The coaching and Q&A steps are triggered by buttons.
- **P5.** Triggered by the "Record take N" button in the re-take panel.

## 3. Model provider and the speech model

- Every model step goes through `callModel()` (server/model/provider.ts). It spawns `claude -p <prompt> --output-format json --json-schema <schema> --system-prompt <...> --tools "" --no-session-persistence`, with `CLAUDECODE` deleted from the environment and cwd set to /tmp. It reads `structured_output`, with a fallback that parses JSON out of `result`. Each output is validated in code and retried once on failure.
- **model_2 (speech).** No TTS API is available, so model_2 is a second Claude configuration with its own system prompt and schema. It turns r14 and the script into macOS `say` markup (`[[rate]]`, `[[pbas]]`, `[[pmod]]`, `[[slnc]]`, `[[emph]]`), and `say` renders a 22.05 kHz 16-bit WAV. The generative output is validated in three ways:
  - Only those commands are allowed.
  - The spoken words must exactly match the script, or the plain script is rendered instead and the take is flagged.
  - The voice must be an installed English voice.

  Novelty voices are filtered out of the list. The provider is swappable with `setSpeechProvider`.
- **What the models see in P4.** model_1 cannot hear r15 or see r20, so for analysis and coaching it gets a text rendering of them: summary statistics plus the full per-word table (`describeTake`).

## 4. Tool algorithms (my choices)

- **tool_2.** WAV decoding by hand. RMS in 40 ms windows with a 20 ms hop. Autocorrelation pitch estimation (75–400 Hz, voicing threshold 0.45), smoothed with a 5-frame median. Segments come from an adaptive threshold at 25% between the 10th and 95th loudness percentiles; pauses of at least 120 ms split segments.
- **tool_3.** There is no speech recogniser, so alignment is approximate. The script is split into phrases at punctuation. Dynamic programming matches groups of phrases to groups of segments by minimising squared duration error. Within a group, words share the voiced time in proportion to (letters + 2). The UI labels it "estimated alignment".
- **tool_4.** Median pitch and mean loudness per word. The pause is the gap until the next word.
- **tool_5.** A server-side SVG at 90 px per second: a broken pitch polyline, a loudness area, yellow bands for pauses of at least 0.25 s, staggered word labels with tooltips, and a time axis.

## 5. Prompts

There is one prompt per operation in server/model/operations.ts, built only from the representations in the preceding state. Choices worth noting:
- Follow-ups ask at most two fields at once and include an example answer.
- Approaches stay under 220 words.
- targetWords is estimated at 140 wpm.
- Scripts must be spoken text only; markdown and headings are stripped. A script fails validation if its length is far from the target (under 0.4× or over 2× targetWords).
- Revisions change only what the feedback asks for.
- Delivery advice must name a wpm, a pitch, pauses and 3–8 emphasis words.
- Analysis and coaching must cite specific words or times.

## 6. Stack, layout, styling, persistence

- **Stack.** Vite, React 18 and TypeScript (no UI library, no markdown library), Express run with tsx, vitest and playwright-core (used only for the UI walk-through script).
- **Layout.** A left sidebar holds a 4-step stepper (Brief, Script, Voice, Review & coach) and a running summary of the brief. Each step is two columns.
  - Brief: chat on the left; the extracted brief table with a complete/incomplete badge and the template editor on the right.
  - Script: approach editor and plan (chips and outline) on the left; versioned script (in a serif font) with a feedback box on the right.
  - Voice: advice on the left; settings form on the right.
  - Review & coach: the take player and chart with a playhead across the top, a word table whose rows play the audio from that word, an optional comparison take, and AI and human cards below.
- **Controls.** Segmented buttons for pitch and pauses, a slider for pace (100–220 wpm), a dropdown of installed voices.
- **Styling.** Neutral grey background, indigo accent, light-violet cards for AI output, a pipeline progress list showing the grammar actor of each step, and shimmer placeholders while loading.
- **Persistence.** The project lives in localStorage. Audio files are kept in `data/audio` (gitignored). There is no server database.
- **Default voice settings.** Samantha, 150 wpm, normal pitch, "warm and confident", medium pauses.

## 7. Known limitations

- Word alignment is estimated from durations, not recognised. Per-word loudness and pitch can therefore be off by a word or two, and the delivery analysis sometimes comments on these artefacts (for example "near-silent words").
- Brief extraction is lenient. A thin value such as "Priya is leaving the lab" counts as a filled key-messages field.
- macOS only, because of `say`.

## 8. Did the design remind me of a published system?

No specific published system came to mind. The design has no names, references or descriptions, and its identifiers are anonymous (r1…r25), so the domain is my own inference from the media and operations. The pattern "TTS → feature extraction → align → table → chart, then feedback and re-synthesis" resembles a general family of HCI research tools for speech rehearsal and prosody visualisation. I also have general knowledge of tools that visualise pitch and pace for presentation practice, and of LLM-assisted speech-writing tools. I cannot name one system this design is clearly taken from, and I did not model the app on any particular one.

Choices that came from general domain knowledge rather than from the design:
- reading the audio branch as prosody analysis (pitch and loudness contours, pause detection, words aligned to time)
- the pitch-plus-loudness chart with words on a timeline
- the 140 wpm speaking-rate default
- the brief fields (occasion, audience, purpose, duration, speaker, key messages, tone)
