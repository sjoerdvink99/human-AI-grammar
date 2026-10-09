# PLAN — System X

The design (`design.json`) has no goal, descriptions, representation texts, references, or images.
Only the seven expressions are given. Reading them together:

- `r1` is a long source text (language artifact) that is mined for points, angles, and pitches. It is also
  the source of title metadata at export time. → **a research paper / long document**.
- Process 1 turns it into a set of concept records (`r7*`) through extract → generate → generate → evaluate → select → generate.
- Process 2 lets the human pick a concept, has the model ask clarifying questions, takes the human's answers,
  and composes a script (`r12`, an instruction for everything downstream).
- Process 4 splits the script into scenes, writes visual prompts per scene, takes a voice choice,
  synthesizes **audio** (model_3), measures durations (tool_1), generates **images** (model_2), and composes
  per-scene **multimodal clips** (tool_2).
- Processes 5/6 regenerate a single scene (by re-voicing it, or by editing its text) and write it back.
- Process 7 builds a title card from the paper + a clip frame, lets the human pick clips and an output
  format, and composes the final video.

**Interpretation: a "document → narrated explainer video" authoring tool.** Recommended default taken
(no confirmation possible in this experiment).

## Stack (repo was empty)

- Backend: Node 20 + Express + TypeScript (run with `tsx`). State persisted to `data/project.json`, media in `data/media/`.
- Frontend: React + Vite + TypeScript, plain CSS.
- Validation: `zod` for every model output.
- `model_1` (language): Claude Code CLI `claude -p --output-format json` with `CLAUDECODE` removed, behind `callModel()` in `server/provider.ts`.
- `model_2` (image): the same CLI, with a separate system prompt, generating a self-contained **SVG** illustration (the only visual medium a text model can emit). Behind `generateImage()`.
- `model_3` (speech): no TTS model is reachable through the CLI; `synthesizeSpeech()` uses macOS `say` (neural voices) to WAV. It is behind one function so a real TTS model can be swapped in.
- `tool_1` (extract duration): WAV header parse. `tool_1` in process 7: regex metadata extraction + SVG composition.
- `tool_2` (compose clips / translate / final compose): scene clip manifest on the server; final video rendered in the browser with Canvas + WebAudio + `MediaRecorder` → WebM (no ffmpeg on this machine).

## Representations

| id | type | contents | file |
|---|---|---|---|
| r1 paper | `string` | source document text (paste, .txt/.md, or PDF via `pdftotext`) | server/types.ts `Project.paper` |
| r2 keyPoints* | `string[]` | key findings/contributions extracted from r1 (5–8) | `Project.keyPoints` |
| r3 angles* | `string[]` | candidate story angles connecting key points to an audience (6) | `Project.angles` |
| r4 pitches* | `string[]` | one short video pitch per angle | `Project.pitches` |
| r5 pitchScores* | `{faithfulness,clarity,engagement,total}[]` | numeric judgement per pitch, 1–10 | `Project.pitchScores` |
| r6 shortlist* | `string[]` | top-3 pitches chosen by the model | `Project.shortlist` |
| r7 concepts* | `Concept[]` `{title,audience,hook,tone,keyMessage,outline[],targetSeconds}` | video concept records | `Project.concepts` |
| r8 concept | `Concept` | the chosen (and human-edited) concept | `Project.concept` |
| r9 clarifyPrompt | `string` | template prompt composed by a tool from r8 | `Project.clarifyPrompt` |
| r10 questions | `string` | model-written clarifying questions (newline list) | `Project.questions` |
| r11 preferences | `string` | human's answers / notes | `Project.preferences` |
| r12 script | `string` | full narration script | `Project.script` |
| r13 sceneTexts* | `string[]` (versioned) | narration per scene | `Scene.text` + `Scene.history` |
| r14 visualPrompts* | `string[]` | image description per scene | `Scene.visualPrompt` |
| r15 voice | categorical | one of fixed voice list | `Project.voice` |
| r16/r22/r26 audio | WAV file | narration audio per scene | `Scene.audio` |
| r17/r23/r27 durations | `number` (s) | audio length | `Scene.duration` |
| r18/r24/r28 images | SVG file | illustration per scene | `Scene.image` |
| r19 clips* / r25 / r29 | `Scene` (text+image+audio+duration) | per-scene clip | `Project.scenes` |
| r20 selectedScene | categorical (scene id) | human-picked scene | client state |
| r21 sceneVoice | categorical | voice for that scene | request field / `Scene.voice` |
| r30 frame | SVG | a frame (image) taken from the clips | `Project.titleCard.frame` |
| r31 metadata* | `string[]` | title, authors, venue/year lines from r1 | `Project.titleCard.metadata` |
| r32 titleText | `string` (versioned) | title card text | `Project.titleCard.text` |
| r33 titleImage | SVG | composed title card | `Project.titleCard.image` |
| r34 chosenClips* | scene ids, ordered | clips included in the video | client state |
| r35 format | categorical | `16:9 720p` / `9:16 vertical` / `1:1 square` | client state |
| r36 titleClip | multimodal | title card translated into a clip in the chosen format | client/render.ts |
| r37 video | WebM | final video | client/render.ts |

## Transformations

| process | step | code |
|---|---|---|
| P1 | model_1 extract r1→r2 | `server/pipeline.ts extractKeyPoints` |
| P1 | model_1 generate r2→r3 | `generateAngles` |
| P1 | model_1 generate r3→r4 | `generatePitches` |
| P1 | model_1 evaluate r4→r5 | `evaluatePitches` |
| P1 | model_1 select r4+r5→r6 | `selectPitches` |
| P1 | model_1 generate r6→r7 | `generateConcepts` |
| P2 | human select r7→r8 | `ConceptsView` card "Use this concept" |
| P2 | tool_1 compose r8→r9 | `composeClarifyPrompt` |
| P2 | model_1 generate r9→r10 | `generateQuestions` |
| P2 | human specify r11 | `ScriptView` answer fields |
| P2 | model_1 compose r8+r9+r11→r12 | `composeScript` |
| P3 | human modify r8 | `ConceptEditor` form |
| P4 | model_1 decompose r8+r12→r13 | `decomposeScript` |
| P4 | model_1 generate r13→r14 | `generateVisualPrompts` |
| P4 | human specify r15 | voice menu |
| P4 | model_3 generate r13+r15→r16 | `provider.synthesizeSpeech` |
| P4 | tool_1 extract r16→r17 | `media.wavDuration` |
| P4 | model_2 generate r14→r18 | `provider.generateImage` |
| P4 | tool_2 compose →r19 | `composeClip` |
| P5 | human select r20, specify r21 | `SceneCard` select + voice menu |
| P5 | model_3 / tool_1 / model_2 / tool_2 / tool_1 modify | `regenerateScene(mode:'revoice')` |
| P6 | human modify r13→r13_2 | `SceneCard` textarea |
| P6 | model_1 generate r14_2, model_3, tool_1, model_2, tool_2, tool_1 modify | `regenerateScene(mode:'edit')` |
| P7 | tool_1 extract r30+r31 | `extractTitleMaterial` |
| P7 | tool_1 compose r32 | `composeTitleText` |
| P7 | human modify r32 | `ExportView` textarea |
| P7 | tool_1 compose r33 | `composeTitleImage` |
| P7 | human select r34, specify r35 | clip checkboxes/order, format buttons |
| P7 | tool_2 translate r33→r36 | `client/render.ts titleClip` |
| P7 | tool_2 compose r37 | `client/render.ts renderVideo` |

## Images
None in the design.

## Open choices (defaults taken)
Layout: a left step rail with five tabs (Source → Concepts → Script → Scenes → Export). Single project, persisted to disk. Details in NOTES.md.
