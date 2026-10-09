# NOTES — decisions the design did not determine

The design fixes which steps exist, who performs them, what each representation contains, and how the processes connect. Everything below was my choice.

## Stack and infrastructure
- **Stack:** Node 20 + Express (TypeScript via `tsx`) backend; React 18 + Vite + TypeScript frontend. No UI library, hand-written CSS.
- **Persistence:** one JSON file per project (`data/projects/<id>/project.json`) with media files alongside, served under `/media`. No database, no accounts.
- **Background work:** long steps run as background jobs; the browser polls every 1.5 s while anything runs. Project-level jobs (`busy`) run one at a time; scene jobs run in parallel with their own status per scene. A server restart marks running jobs as interrupted.
- **Model concurrency:** at most 4 CLI calls at once (`MODEL_CONCURRENCY`).
- **Libraries:** `ffmpeg-static` (no system ffmpeg was installed), `@resvg/resvg-js` (SVG → PNG), `multer` (upload), poppler CLI tools for PDF text, metadata and the first-page image.

## Model providers (no API key available)
- **model_1 (LLM):** Claude Code CLI via `callModel()` (`claude -p --output-format json --json-schema <schema> --system-prompt … --tools "" --no-session-persistence`, `CLAUDECODE` unset). The prompt goes in on stdin. Every call has a JSON Schema and a validator; if validation fails, the call is retried once with the error appended.
- **model_2 (video generation):** there is no local video model, so Claude draws 1–3 SVG keyframes per scene (one per ~4.5 s of narration), and ffmpeg animates them with slow zoom and pan moves (`zoompan`) to exactly the narration length plus 0.35 s. The SVGs are sanitised (no scripts, foreignObject or external hrefs) and test-rendered as part of validation. If the model fails twice, a gradient title card is used instead.
- **model_3 (TTS):** macOS `say`. One Claude call per voice style maps `voice_style` onto an installed English voice and a speaking rate (150–260 wpm). The result is cached and shared across scenes running in parallel so all scenes use the same voice. Novelty voices are filtered out. Prosody such as "slight lift on surprising numbers" can't be expressed beyond the choice of voice and rate.
- **Model prompts** (all in `server/pipeline.ts` / `server/media.ts`): one shared system prompt ("science communicator… never invent results… answer only with JSON"). Each operation has its own prompt built only from its preceding state. Specifics:
  - paper text truncated to 60 000 characters
  - 5–8 findings; 5 story ideas; 10 hooks of ≤20 words
  - hook ratings 1–10 with a reason, penalising overstatement
  - shortlist = model picks exactly 4 distinct hooks, favouring high scores and diversity
  - script options: 4 × (title, hook, 8 scenes of 12–30 words, scene 1 opens with the hook, ~60 s total)
  - tone suggestion ≤30 words
  - voice style merge ≤60 words, keeping the fast pace unless told otherwise
  - decompose = 8 TTS-ready narrations, keeping the researcher's wording but spelling out symbols
  - visual prompts: flat vector, 9:16, consistent palette, no real faces or logos
  - revised visual prompt receives all scene narrations plus the old prompt so the style stays consistent

## Data formats
- `script` = `{title, hook, scenes[8]}`; `hook_ratings` = `{hookId, score, reason}`; `shortlisted_hooks` = hook ids.
- `scene_scripts` and `visual_prompts` are stored per scene (`Scene.script`, `Scene.visualPrompt`) with version counters. These are the v1→v2 changes in process 6.
- Every produced clip is a `ClipVersion` (audio, duration, silent video, composed clip, plus the script and prompt used). Earlier versions are kept, and a version menu restores them. Restoring also restores that version's narration and prompt.
- `scene_request`, `regeneration_request` and `merge_request` (categorical) are button presses / HTTP endpoints, not stored objects.
- Video: 720×1280, 30 fps, H.264 yuv420p, AAC 44.1 kHz stereo. The credit clip lasts 4 s with silent audio. The final file is `final/final_video_<timestamp>.mp4`.
- Captions: narration split into chunks of ≤6 words (or at sentence punctuation), wrapped at 22 characters, and timed in proportion to character count across the measured audio duration. They are burned in with `drawtext` (Arial Bold 50 px, white with black outline, at 74 % of the frame height, each line centred).
- Authors: PDF `Author` metadata if present, otherwise a first-page heuristic (capitalised 2–4-word names in the lines after the title, before "Abstract"). The researcher can correct them in the credit text.
- Credit text default: "Based on the paper:" / “Title” / authors (more than 4 authors → "et al.").
- Credit scene: dark navy background, attribution text on top, the first-page image below on a white card.
- Baseline voice style: a fixed string, "fast-paced… about 180–200 words per minute…".

## Triggers and interaction details
- Process 1 starts automatically on upload. A "Regenerate options" button reruns the whole process.
- Process 2: choosing a script immediately requests a tone suggestion. "Suggest another" regenerates it. "Accept suggestion" and "Use this tone" (the textarea is prefilled with the suggestion) both submit `tone_preference`.
- Process 4 starts automatically the first time a voice style is set (the design says "after the script and voice style are set"). After script edits, a "Rebuild storyboard" notice appears; rebuilding discards existing clips after a confirmation dialog. Clip generation itself waits for the explicit "Generate all scenes" or per-scene "Generate scene" request.
- Process 3: the editor is available any time after selection. "Use original script" reverts to the unedited option.
- Process 5/6: clicking a scene card selects it (highlight = `scene_selection`). Narration can only be edited once a clip exists (process 6 says "after clips have been generated"). If the text is unchanged, the card offers "↻ Regenerate" (process 5); if edited, "Save & regenerate" (process 6).
- Process 7: credits are prepared automatically once every scene has a clip ("Prepare credits now" forces it earlier). All clips are approved by default via checkboxes. Merging is blocked while scenes are generating. Any later scene or credit change clears the final video so a stale file isn't offered.
- **Layout:** dark top bar with the paper title; a left step rail (Hooks & scripts → Voiceover style → Edit script → Storyboard → Credits & export); the main panel shows one step. Option cards sit in a responsive grid. The "How these were made" panel holds findings, story ideas, and hooks with rating bars and shortlist tags. The storyboard is a grid of 9:16 scene cards, each with a player, a loading overlay showing the current stage, the narration, a collapsible visual prompt, and a version menu. The view moves forward automatically when a background step unlocks the next one.

## Verification performed
- `npm run typecheck`, `npm test` (5 unit tests: captions, wrapping, author parsing, credit text, SVG sanitising) and `npm run build` all pass.
- I walked through all 7 processes via the HTTP API on a generated test paper. Process 1 took about 2 minutes. Producing all 8 scenes in parallel took about 2 minutes. I ran a regeneration, a scene revision with a new visual prompt, a credit-text edit, a merge into a 68 s MP4, and a version restore. I inspected the rendered frames and the credit screen by eye.
- The React UI built and served, but I did **not** click through it in a browser in this session; the API calls it makes are the same ones exercised above.
- Bugs found and fixed during the walkthrough: wrong `say` output format for AIFF; parallel scenes each choosing their own TTS voice.

## Did the design remind me of a published system?
Yes, loosely. The pipeline (paper → findings → hooks rated and shortlisted → script options → narrated scenes with captions → per-scene regeneration → author credit screen → vertical short video) resembles recent HCI research prototypes that turn research papers into short-form science-communication videos for TikTok/Reels/Shorts. I can't confidently name the specific paper or title, so I'm not attributing it to one system. I didn't look anything up.

Choices influenced by that general genre knowledge rather than the design:
- The ~60-second target length and 9:16 720×1280 format (the design only says "short vertical video").
- Burned-in, short, word-chunked captions in the lower third, typical of TikTok/Reels.
- Script structure in the prompt (hook → problem → method → findings with numbers → why it matters → closing line), and penalising hooks that overstate the paper.
- Treating the credit screen as the last clip, showing the paper's first page.

Everything else (SVG-keyframe stand-in for the video model, `say` for TTS, version history, the UI layout) came from the constraints of this environment and my own defaults, not from a known system.
