# NOTES — decisions the design did not determine

The design has seven process expressions but no goal, no descriptions (system or process), no
representation descriptions, no references and no images. Everything below was my choice.

## Interpretation
- **Purpose**: from the identifiers (paper, findings, hooks, script, voice style, scene audio/videos,
  credit scene, final video) I took this to be a "research paper → short narrated explainer video" tool.
- **Model roles**: model_1 = language model (all text steps); model_2 = visual/video generator
  (it consumes visual prompts + durations, produces `scene_videos: visual`); model_3 = text-to-speech
  (produces `scene_audio: audio` from scene scripts + voice style).
- **Process triggers** (no descriptions given):
  - P1 runs automatically after the paper is uploaded (six model_1 calls in sequence, each a separate
    endpoint, with a step-progress pill bar). Each card has "Regenerate", which reruns the chain from that step.
  - P2: selecting a script immediately composes the baseline (tool) and asks model_1 for a tone suggestion;
    the user then edits the preference (textarea prefilled with the suggestion) and clicks "Compose voice style".
  - P3: script is an always-editable form with Save/Discard; edits after scenes exist require re-splitting.
  - P4: "Split script into scenes" runs decompose and then visual prompts back-to-back; rendering waits
    for the human `scene_request`.
  - P5/P6 loops: closed by `tool_1 modify` replacing the clip; earlier clips are kept and restorable, earlier
    narration/visual-prompt versions are listed under "Earlier versions".
  - P7 starts from an explicit "Extract authors & screenshot" button once at least one clip exists.
- **Categoricals** (values not given):
  - `scene_request`: `"all"` or a single scene index ("Render all scenes" / per-scene "Render").
  - `regeneration_request`: `new_take | more_energetic | calmer` (variation applied to TTS rate; video is re-rolled).
  - `merge_request`: `credit_end | credit_start` (position of the credit clip).
  - `scene_selection`: index of the clicked scene card.
- **Record schema** for `script_options`/`script`: `{title, hook, body, closing, target_seconds}`.
- **Counts**: 4–8 findings, 3–5 story ideas, 6–10 hooks, ratings 1–10 (one overall score), shortlist of 3,
  one script option per shortlisted hook, 4–8 scenes. Credit clip lasts 4 s. Each scene gets +0.4 s padding.
- **Validation of generative output**: every JSON-producing call is validated (array lengths, number ranges,
  required fields), with one retry that tells the model what was wrong. The shortlist is enforced in code to be
  a subset of the generated hooks (model returns indices). Ratings are clamped to 1–10 and must align with hooks.
  Model-written SVG is sanitised (no scripts, foreignObject, external hrefs, event handlers).
- `baseline_voice_style` (tool compose): deterministic template using words-per-minute derived from the script.
- `paper_authors` extraction (tool): PDF `Author` metadata, else name-shaped tokens between the title and
  "Abstract" on page 1. Pasted-text papers get a rendered title card as the "screenshot".
- `credit_text_1`: `Based on the paper “<title>” by A, B, and C.`

## Providers and libraries
- **No API key** → every model call is behind one function per modality:
  - `callLLM` (`server/providers/llm.ts`) spawns `claude -p --output-format json --tools "" --no-session-persistence
    --model sonnet --system-prompt …` with `CLAUDECODE` removed; prompt via stdin.
  - `generateVideo` (model_2): no video model was available, so Claude (separate system prompt) draws an SVG keyframe
    for the visual prompt, `rsvg-convert` renders it to 720×1280 PNG and ffmpeg animates it with a slow zoom for
    exactly the narration duration. Falls back to a gradient text card after two failures (and warns in the UI).
  - `synthesizeSpeech` (model_3): macOS `say` (WAV). Voice style is mapped by keywords to voice (Samantha / Daniel /
    Kate) and speaking rate. This is the weakest stand-in: most of the voice style's nuance is not audible.
- Duration extraction reads the WAV header (no ffprobe needed). ffmpeg from `ffmpeg-static`; PDF parsing with poppler.
- Stack: Express + TypeScript (tsx) backend, React + Vite frontend, plain CSS, `multer` for uploads, `node:test` tests.
- Persistence: one JSON file + media folder per project under `data/projects/<id>/`; project list in the header.
- Rendering runs in the background (concurrency 3) with in-memory per-scene status; the UI polls every 3 s.

## Prompts (summary; full text in `server/pipeline.ts` and `server/providers/video.ts`)
- Shared model_1 system prompt: science-communication writer for 45–90 s vertical videos, never invent results, JSON only when asked.
- Paper text is passed in full up to 60k characters in every step whose state includes `paper_1`.
- Each step's prompt is built only from the representations in its preceding state (e.g. hooks see paper + story ideas,
  not findings; visual prompts see scene scripts + voice style).

## Layout and styling
- Single page with five numbered sections that appear progressively: 1 Paper & story, 2 Script, 3 Voice style,
  4 Scenes, 5 Credits & final video. Sticky header with project picker; sticky busy/error banner.
- Hooks shown with inline rating bars and a "shortlisted" tag; script options as three cards.
- Scenes as cards with a 9:16 clip player on the left, narration + visual prompt on the right; clicking selects
  a scene and reveals regenerate buttons, "Edit narration" and history.
- Credits: screenshot + credit-scene previews side by side; approval as thumbnail checkboxes; final video player
  with a download link. Indigo accent, light grey background, system font.
- Video format: vertical 720×1280, 25 fps, H.264/AAC mono.

## Verification
- `npm run typecheck`, `npm test` (6 tests incl. a real say → ffmpeg → concat run) and `npm run build` pass.
- Walked through all seven processes against the running server with a sample PDF: P1 (6 model calls), P2 selection +
  suggestion + voice style, P3 via `PUT /script`, P4 split/prompts/render of 8 scenes, P5 "calmer" regeneration,
  P6 narration revision (new prompt v2, clip replaced, history kept), P7 authors extracted from the PDF, credit scene
  composed, final 98 s MP4 merged. The UI was checked to build and be served via the Vite proxy, but I did not click
  through it in a browser.

## Did the design remind me of a published system?
Somewhat, but not of one specific system I can name with confidence. The shape — paper → findings → hooks rated and
shortlisted → script → voice → per-scene TTS + generated visuals → credits → merged short video — resembles the
recent line of HCI/AI research on turning scientific papers into accessible media (paper-to-podcast and
paper-to-short-video tools, "Paper2Video"-style work), but I am not certain which paper this design encodes and I did
not look it up. Choices that came from general background knowledge rather than from the design:
- vertical 9:16 format and a 45–90 s target length (short-form video conventions, e.g. TikTok/Reels/Shorts);
- treating a "hook" as the first spoken line meant to stop scrolling, and rating hooks on curiosity, clarity and faithfulness;
- the "flat editorial illustration" visual style and the slow-zoom ("Ken Burns") animation;
- the credit scene layout (paper first page + "Based on … by …"), and offering it at start or end.
