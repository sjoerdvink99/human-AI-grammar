# System X — guided image labeling

A web app built from `design.json` (7 processes). It prepares an image dataset, has models label it
using a library of guidelines, a user profile and a concept taxonomy, routes uncertain items to human
review, lets the reviewer ask about an item, and learns new guidelines and preferences from the
human labels. The task can then be re-run with an edited instruction.

## Run

```bash
npm install
npm start            # http://localhost:3000
npm test             # tool-step and validation tests
npm run check        # syntax check
```

Requires the Claude Code CLI (`claude`) on PATH. Every model step goes through `callModel()` in
`server/llm.js`, which runs `claude -p --output-format json` with `CLAUDECODE` removed from the
environment. To use another provider, change only that function. Environment variables:
`CLAUDE_MODEL` (passed as `--model`), `CLAUDE_BIN`, `MODEL_TIMEOUT_MS`, `PORT`, `DATA_DIR`.

How to use it: **Load demo dataset** → **Prepare dataset** → **Suggest guidelines** → tick the
guidelines to apply → **Run labeling**. Then pick images from the review queue and use
**Review** or **Ask the assistant**. After that, run **Learn guidelines** and **Update profile**, edit
the instruction, and click **Re-run with edited instruction**.

## Design mapping

| Process | Step | Implementation |
| --- | --- | --- |
| 1 Prepare | tool_1 extract (r2 → r3 regions, r4 object labels) | `tool1Extract` — server/tools.js |
| | model_1 generate~ (→ r5 captions, r6 descriptions) | `model1Describe` (vision through the CLI's Read tool) — server/pipeline.js |
| 2 Label run | model_2 select (→ r11 suggested guidelines) | `model2SelectGuidelines` — server/pipeline.js |
| | human select (→ r12 active guidelines) | guideline checkboxes — public/app.js `renderTask` |
| | tool_2 translate (r5 → r13 caption vectors) | `tool2EmbedCaptions` — server/tools.js |
| | tool_3 translate (r12 → r14 guideline vectors) | `tool3EmbedGuidelines` — server/tools.js |
| | model_3 assign (→ r15_1 task labels) | `model3Assign` — server/pipeline.js |
| | model_3 modify (r15_1 → r15_2) | `model3Refine` |
| | model_3 generate~ (→ r16 rationales) | `model3Rationales` |
| | model_4 evaluate (→ r17 support scores) | `model4ScoreRationales` |
| | model_4 select (r10 → r18 concepts) | `model4SelectConcepts` |
| | model_4 generate~ (→ r19 reviewer notes) | `model4ReviewNotes` |
| | model_4 evaluate (→ r20 uncertainty) | `model4ScoreNotes` |
| | model_4 select (→ r21 review queue) | `model4SelectQueue` |
| 3 Review | human select (r22) / evaluate (r23) / assign (r24) | gallery + "Review" card — public/app.js `renderInspector`; `POST /api/p3/review` |
| | tool_4 extract (→ r25 labeled examples) | `tool4Extract` — server/tools.js |
| 4 Ask | human select (r26) / specify (r27) | inspector "Ask the assistant" |
| | model_5 generate~ (→ r28 reply) | `model5Answer` — server/pipeline.js |
| | human evaluate (r29) / assign (r24_2) | Helpful / Not helpful + label menu; `POST /api/p4/judge` |
| | tool_4 expand (→ r25_2) | `tool4Expand` — server/tools.js |
| 5 Learn guidelines | model_6 extract (r30), model_7 generate~ (r31), model_8 match (r32) / evaluate (r33) / modify~ (r8_2) | `process5` — server/pipeline.js |
| 6 Update profile | model_9 extract~ (r34), model_10 modify (r9_2) | `process6` — server/pipeline.js |
| 7 Re-run | model_2 select, human select, model_3 assign, model_3 generate~, model_4 evaluate, model_4 select, model_4 generate~ | `process7Suggest` / `process7Run` — server/pipeline.js |

The state keys in `server/store.js` are named after the identifiers, for example `captions` for r5,
`reviewQueue` for r21 and `labeledExamples` for r25. Versioned representations (r7 instruction,
r8 guidelines, r9 profile, r15 task labels) keep their full history, and the UI can restore earlier
versions.
