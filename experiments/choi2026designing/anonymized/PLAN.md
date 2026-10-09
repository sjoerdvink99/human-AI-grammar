# PLAN — System X

The design has no goal, description, representation descriptions, references or images. The only
information is the structure of the five processes. This plan infers a domain that fits all of it and
takes that as the default. Per the experiment instructions, it continues without waiting for confirmation.

## Inferred interpretation: "Speech Studio", for writing and rehearsing a speech

* **Process 1, brief intake loop.** The user describes the speech they need (r2) against a brief template (r1).
  The model extracts a structured brief (r3). A tool checks whether it is complete (r4). The model asks a
  follow-up question (r5). The user answers, which extends r2, and the loop repeats until the brief is complete.
* **Process 2, script writing.** The model proposes an approach (r6). The user edits it into their own approach (r7).
  The model extracts a style spec (r8) and an outline (r9), then writes the script (r10). The user comments (r11),
  the model revises r10, and this loop repeats.
* **Process 3, first voice take.** The model gives delivery advice (r12). The user fills in voice settings (r13).
  The model turns them into a natural-language voice direction (r14). A second model role, the speech model,
  renders audio (r15). Tools analyse the audio into speech segments (r16) and a prosody contour (r17), align the
  script words to the audio (r18), build a per-word feature table (r19) and draw a prosody chart (r20).
* **Process 4, review and coaching.** The model analyses the delivery (r21). The user writes their own listener
  feedback (r22). The model gives coaching tips (r23). The user asks the coach a question (r24) and the model
  answers it (r25).
* **Process 5, re-take.** The user adjusts the voice settings while looking at their feedback (r13_1 → r13_2).
  The rest of the process 3 pipeline then runs again, producing take 2 and later takes. All takes are kept so
  they can be compared.

## Representations

| id | type | contents | file |
|---|---|---|---|
| r1 briefTemplate | instruction record | required fields: name, description, required flag | shared/types.ts, server/defaults.ts |
| r2 request | artifact language | the user's description and answers, as a list of messages joined into text | web state (App.tsx) |
| r3 brief | artifact record | one value per template field, or null | shared/types.ts |
| r4 briefStatus | evaluation categorical | `complete` or `incomplete`, plus the missing field names | server/tools/briefCheck.ts |
| r5 followUp | artifact language | the next question, or a confirmation | server/model/prompts.ts |
| r6 approach | artifact language | proposed angle and structure, in prose | " |
| r7 approachEdited | artifact language | the user's edited approach | web Script step |
| r8 styleSpec | instruction record | tone, targetWords, register, audienceLevel, mustInclude[], avoid[] | shared/types.ts |
| r9 outline | artifact record | sections[] {title, keyPoints[], seconds} | " |
| r10 script | artifact language | the speech text, with all versions kept | " |
| r11 scriptFeedback | evaluation language | the user's critique | web |
| r12 deliveryAdvice | artifact language | prose advice on how to deliver the speech | prompts |
| r13 voiceSettings | instruction record | voice, rate (wpm), pitch, tone, pauses, emphasisWords[] | shared/types.ts |
| r14 voiceDirection | instruction language | the voice direction in natural language | prompts |
| r15 takeAudio | artifact audio | a WAV file served from /audio | server/model/speech.ts |
| r16 segments | artifact record | voiced segments {start, end} | server/tools/audioAnalysis.ts |
| r17 prosody | artifact record | frames {t, pitchHz, rmsDb} | " |
| r18 wordTimings | artifact record | words {word, start, end} | server/tools/align.ts |
| r19 wordFeatures | tabular | rows: word, start, end, dur, pitch, loudness, pauseAfter | server/tools/features.ts |
| r20 prosodyChart | visual | an SVG chart | server/tools/chart.ts |
| r21 deliveryAnalysis | artifact language | the model's analysis of the take | prompts |
| r22 listenerFeedback | evaluation language | the user's feedback on the take | web |
| r23 coachingTips | artifact language | practice tips | prompts |
| r24 coachQuestion | artifact language | the user's question | web |
| r25 coachAnswer | artifact language | the answer | prompts |

## Transformations

| process | step | function | file |
|---|---|---|---|
| P1 | model_1 extract r1+r2→r3 | `extractBrief` | server/model/operations.ts |
| P1 | tool_1 evaluate r3→r4 | `checkBrief` | server/tools/briefCheck.ts |
| P1 | model_1 generate →r5 | `generateFollowUp` | operations.ts |
| P1 | human specify r5→r2 (loop) | answer box in BriefStep | web/src/steps/BriefStep.tsx |
| P2 | model_1 generate r2+r3→r6 | `generateApproach` | operations.ts |
| P2 | human specify r6→r7 | editable approach text | ScriptStep.tsx |
| P2 | model_1 extract r7→r8+r9 | `extractPlan` | operations.ts |
| P2 | model_1 generate r8+r9→r10 | `generateScript` | operations.ts |
| P2 | human evaluate r10→r11 | feedback box | ScriptStep.tsx |
| P2 | model_1 modify r10+r11→r10 (loop) | `reviseScript` | operations.ts |
| P3 | model_1 generate r10+r8→r12 | `generateDeliveryAdvice` | operations.ts |
| P3 | human specify r12→r13 | voice settings form | VoiceStep.tsx |
| P3/P5 | model_1 translate r13→r14 | `translateVoiceSettings` | operations.ts |
| P3/P5 | model_2 generate r14(+r10)→r15 | `synthesizeSpeech` | server/model/speech.ts |
| P3/P5 | tool_2 extract r15→r16+r17 | `analyzeAudio` | server/tools/audioAnalysis.ts |
| P3/P5 | tool_3 match r10+r16→r18 | `alignWords` | server/tools/align.ts |
| P3/P5 | tool_4 extract r18+r17→r19 | `buildWordFeatures` | server/tools/features.ts |
| P3/P5 | tool_5 translate r19→r20 | `renderProsodyChart` | server/tools/chart.ts |
| P4 | model_1 generate r15+r20+r10→r21 | `analyzeDelivery` | operations.ts |
| P4 | human evaluate →r22 | feedback box | ReviewStep.tsx |
| P4 | model_1 generate r15+r10+r22→r23 | `generateCoaching` | operations.ts |
| P4 | human specify →r24 | question box | ReviewStep.tsx |
| P4 | model_1 generate r24→r25 | `answerCoachQuestion` | operations.ts |
| P5 | human modify r13_1→r13_2 | "Adjust & re-take" form in ReviewStep | ReviewStep.tsx |

## Images

None.

## Open choices and defaults taken

* Model provider: the `claude -p --output-format json --json-schema` CLI, with CLAUDECODE removed from the
  environment, behind one function `callModel()` in server/model/provider.ts.
* Speech model (model_2): a second model configuration. Claude turns r14 and the script into macOS `say`
  markup, and `say` renders the WAV. The output is checked to make sure it keeps the script's words.
  The provider is swappable in server/model/speech.ts.
* Stack: Vite, React and TypeScript for the frontend; Express and TypeScript (run with tsx) for the backend;
  vitest for tests.
* Persistence: project state lives in the browser and is saved to localStorage. Audio files go in ./data/audio.
* Layout: a four-step stepper (Brief → Script → Voice → Review & Coach), with a sidebar summarising the brief.
