# Speech Studio (System X)

A web app built from `design.json` (System X). You describe a speech, it collects a complete brief, plans and writes the script, records synthetic voice takes, analyses their delivery, and coaches you. Then you adjust the voice and record again.

## Run

Requirements: macOS (it uses the `say` speech engine), Node 20+, and the Claude Code CLI (`claude`) logged in.

```bash
npm install
npm run dev        # API on :3001, web on http://localhost:5173
# or
npm run build && npm start   # everything on http://localhost:3001
npm test           # unit tests for the tool steps (they synthesize real audio with `say`)
npm run typecheck
node scripts/smoke.mjs       # API walk-through of all five processes (server must be running)
CHROME=/path/to/chrome node scripts/ui-walk.mjs   # browser walk-through, saves screenshots to /tmp
```

Environment variables: `PORT`, `CLAUDE_BIN`, `CLAUDE_MODEL`, `MODEL_TIMEOUT_MS`, `AUDIO_DIR`.

## Where each transformation is implemented

Every model call goes through `callModel()` in `server/model/provider.ts`, which runs `claude -p --output-format json --json-schema …` with `CLAUDECODE` unset. To swap the provider, replace it there. Representation types are named after the design identifiers in `shared/types.ts`, and the client state in `web/src/state.ts`.

| Process | Transformation | Code |
|---|---|---|
| P1 | `[model_1 extract]` r1 + r2 → r3 | `extractBrief` in `server/model/operations.ts`, `POST /api/brief/extract` |
| P1 | `[tool_1 evaluate]` r3 → r4 | `checkBrief` in `server/tools/briefCheck.ts` |
| P1 | `[model_1 generate]~` → r5 | `generateFollowUp` in `operations.ts` |
| P1 | `[human specify]` → r2 (loop) | the chat composer in `web/src/steps/BriefStep.tsx` |
| P2 | `[model_1 generate]~` r2 + r3 → r6 | `generateApproach` in `operations.ts` |
| P2 | `[human specify]` r6 → r7 | the editable approach in `web/src/steps/ScriptStep.tsx` |
| P2 | `[model_1 extract]` r7 → r8 + r9 | `extractPlan` in `operations.ts` |
| P2 | `[model_1 generate]~` r8 + r9 → r10 | `generateScript` in `operations.ts` |
| P2 | `[human evaluate]` → r11 | the feedback box in `ScriptStep.tsx` |
| P2 | `[model_1 modify]~` r10 + r11 → r10 (loop) | `reviseScript` in `operations.ts` |
| P3 | `[model_1 generate]~` r10 + r8 → r12 | `generateDeliveryAdvice` in `operations.ts`, shown in `VoiceStep.tsx` |
| P3 | `[human specify]` → r13 | `web/src/components/VoiceSettingsForm.tsx` |
| P3/P5 | `[model_1 translate]~` r13 → r14 | `translateVoiceSettings` in `operations.ts` |
| P3/P5 | `[model_2 generate]~` r14 → r15 | `synthesizeSpeech` in `server/model/speech.ts` |
| P3/P5 | `[tool_2 extract]` r15 → r16 + r17 | `analyzeAudio` in `server/tools/audioAnalysis.ts` |
| P3/P5 | `[tool_3 match]` r10 + r16 → r18 | `alignWords` in `server/tools/align.ts` |
| P3/P5 | `[tool_4 extract]` r18 + r17 → r19 | `buildWordFeatures` in `server/tools/features.ts` |
| P3/P5 | `[tool_5 translate]` r19 → r20 | `renderProsodyChart` in `server/tools/chart.ts` |
| P4 | `[model_1 generate]~` r15 + r20 + r10 → r21 | `analyzeDelivery` in `operations.ts` (auto-runs for each new take) |
| P4 | `[human evaluate]` → r22 | the feedback box in `web/src/steps/ReviewStep.tsx` |
| P4 | `[model_1 generate]~` → r23 | `generateCoaching` in `operations.ts` |
| P4 | `[human specify]` → r24 | the "Ask the coach" box in `ReviewStep.tsx` |
| P4 | `[model_1 generate]~` r24 → r25 | `answerCoachQuestion` in `operations.ts` |
| P5 | `[human modify]` r13_1 → r13_2 | the "Adjust voice & re-take" panel in `ReviewStep.tsx`, then the take pipeline in `web/src/take.ts` |
