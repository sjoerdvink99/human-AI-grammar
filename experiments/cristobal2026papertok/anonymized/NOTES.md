# NOTES: decisions the design did not determine

The design gives only seven expressions, with opaque identifiers (`r1`…`r37`). It has no goal, description, process names, representation descriptions, references, or images. Everything below was my choice.

## What the system is
- **Overall interpretation**: a "document → narrated explainer video" authoring tool. Why: `r1` is a language artifact mined for content and later for a title card. The pipeline produces audio (model_3), measures it numerically (tool_1), produces visuals (model_2), and composes multimodal clips that become a final multimodal artifact after a format choice.
- **Meaning of each identifier**:
  - r1 is the source document.
  - r2–r7 are key points, story angles, pitches, pitch scores, the shortlist, and concept records.
  - r8 is the chosen concept.
  - r9–r12 are the clarify prompt, the questions, the creator's answers, and the narration script.
  - r13 is the per-scene narration, r14 the per-scene visual descriptions, and r15 the narrator voice.
  - r16–r19 are audio, durations, images, and per-scene clips.
  - r20 and r21 are the selected scene and its new voice.
  - r30–r37 are the frame, the paper metadata, the title text, the title card, the chosen clips, the output format, the title clip, and the final video.
- **r9 (instruction made by a tool)**: a fixed template prompt built from the concept that asks for clarifying questions.
- **r10 → r11**: the model writes 3–5 questions. The human answers each one, plus free notes, and these are composed into a Q/A text.
- **r21 (categorical instruction in process 5)**: interpreted as a per-scene voice choice. Process 5 therefore means "re-voice and redraw this scene". It also produces a new image (r24), as the design requires.
- **Process 6**: the human edits one scene's narration. Only that scene's visual prompt is rewritten; the other prompts stay as they were. Then that scene is re-voiced and redrawn.
- **Process 7, r30**: the image of the first produced clip is used as the title card background. **r31***: title, authors, and year, found heuristically in the first lines of the document. **r36 (translate)**: the title card is turned into a silent 3.5-second clip in the chosen format. **r35**: 16:9, 9:16, or 1:1.
- **r5 score**: three 1–10 criteria (faithfulness, clarity, engagement) and a weighted total, (2·faithfulness + clarity + engagement)/4. The model sees the raw criteria when it selects.
- **Shortlist size**: 3. Number of angles: 6. Key points: 5–8.

## Model steps and prompts
- **model_1**: the Claude Code CLI (`claude -p --output-format json --system-prompt … --tools "" --no-session-persistence`), started with `CLAUDECODE` removed and run from the OS temp directory. Each operation has its own system and user prompt (see `server/pipeline.ts`). The document is truncated at 60k characters.
- **Structured outputs**: JSON is requested in the prompt, extracted from the reply, and validated with zod. On a validation failure the step retries once, with the error added to the prompt.
- **Extra validation**: the scene split must keep the script's text within 15% of its length. The selection must return distinct, in-range indices. The script must be at least 20 words.
- **model_2 (images)**: the CLI cannot produce raster images, so it produces a **flat infographic SVG** (1280×720) with a fixed house style passed in the prompt. The SVG is sanitized: scripts, foreignObject, event handlers, and external hrefs are removed.
- **model_3 (speech)**: the CLI cannot produce audio, so this uses the **macOS `say` synthesizer**, writing 22.05 kHz 16-bit WAV. This is a deviation from "every model step through `claude -p`": a text model cannot emit audio. It sits behind `synthesizeSpeech()` so a neural TTS model can be swapped in. Voices are a fixed list of English voices, filtered to those installed.
- Every model step sits behind three functions in one file (`server/provider.ts`).
- Model: the CLI default, overridable with `CLAUDE_MODEL`.

## Tools
- tool_1 measures duration by parsing the WAV header.
- tool_2 composes clips on the server as a manifest (text + image + audio + duration). The final video is rendered **in the browser** with Canvas, WebAudio, and MediaRecorder, producing WebM (VP9/Opus), or MP4 on Safari. The reason is that ffmpeg is not installed. Rendering runs in real time, so the tab must stay visible.
- Video styling: a light background; captions split by sentence and timed by character count; a slow 4% "Ken Burns" zoom on scene images; 0.35 s of silence between clips. In landscape the caption sits in a dark box over the image; in portrait and square it sits below the image.
- PDF input uses `pdftotext` if it is installed. Plain-text and Markdown files are also accepted.

## Application
- **Stack**: Node 20, Express, TypeScript (tsx), React 19, Vite, zod, and vitest. playwright-core is used only by the e2e script.
- **Persistence**: one project, kept in `data/project.json`, with media under `data/media/`. There is no database and no accounts. "Start over" resets the project.
- **Long model calls**: these run as background jobs, and the UI polls every 1.5 s. One job runs at a time, and conflicts return HTTP 409. Intermediate results (key points, angles, and so on) appear while process 1 is still running.
- **Layout**: a dark left rail with five step tabs. Each tab is enabled once its inputs exist, and on load the app opens the latest available tab. The teal/coral/navy palette is reused in the image style so the UI and videos look alike.
- **Concepts tab**: concept cards in a grid. The full process-1 trace (key points, angles, and a pitch table with score bars and a "shortlisted" tag) is in a collapsible panel.
- **Script tab**: two columns, with the concept editor (process 3) on the left and the questions, answers, and script on the right. The script is read-only, because the design has no human step that modifies r12.
- **Scenes tab**: a grid of cards. Before production each card shows the narration and visual prompt; after production it also shows the image and audio. Clicking a card selects it (r20) and reveals the voice menu and "Regenerate with this voice". Editing the narration textarea shows "Apply edit & regenerate". Earlier versions are kept per scene in a collapsible list for comparison. There is no revert button, because the design has no revert step.
- **Export tab**: a title-card editor beside a live preview, a clip list with checkboxes and ↑/↓ ordering, a segmented format control, and a render button with progress, then a `<video>` preview and a download link.
- **Destructive actions**: confirmation dialogs appear before replacing the document, choosing a new concept, re-planning, or re-producing.
- **Process 3 → 4**: the edited concept is saved in place, as r8 keeps the same version. It is used by the next "Plan scenes". Questions are only regenerated on request ("Ask different questions").

## Verified
- `npm run typecheck` and `npm run build` succeed, and `npm test` passes (8 unit tests on the tools and helpers).
- A full run with the real CLI on `examples/sample-paper.txt`, a document I wrote myself, reached every step:
  - P1 produced 8 key points, 6 angles, 6 pitches and scores, a shortlist of 3, and 3 concepts.
  - P2 produced 5 questions and then the script.
  - P4 produced 9 scenes with audio and SVG images.
  - P5 re-voiced scene 1, and P6 edited scene 2. Both kept history.
  - P7: the title card was prepared and edited. The browser render via `scripts/e2e-render.mjs` produced a 720×1280 WebM of about 20 MB, and I checked a frame visually (image plus caption).

## Did the design remind me of a published system?
Yes, loosely. The concept → script → scenes → TTS → images → per-scene regeneration → assembly shape resembles automatic **paper-to-video / explainer-video generators**: the LLM-based "science communication video" tools of 2023–2025 (for example, Paper2Video-style systems and short-video generators from scientific papers). I could not identify one specific system with confidence from the anonymous structure, and I did not look anything up.

Choices that came from that general familiarity rather than from the design:
- Reading `r1` as a **scientific paper**, and deriving title-card metadata (title, authors, year) from it.
- Reading the process 1 chain as key points → angles → pitches → scores → shortlist → concept cards (audience, hook, tone, outline, length).
- Reading r10/r11 as clarifying **questions and answers** before scriptwriting.
- Reading r17 as **audio durations** used to time the visuals, and r19 as per-scene narrated slides.
- Reading r35 as an **aspect-ratio / platform format** (landscape, vertical, square).
- Burned-in captions and the Ken Burns zoom, which are common conventions in such generated explainer videos.
