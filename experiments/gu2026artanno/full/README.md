# System X — annotating culturally implicit meanings in artworks

Built from `design.json` (Human-AI grammar design). Annotators define a task, choose suggested skills, review
model-proposed clusters/labels/rationales, ask a chatbot, and the system distils their interactions into reusable
skills and knowledge that a later task reuses.

## Run

```bash
npm install
npm start            # http://localhost:3000 (PORT to change); seeds 8 sample artworks on first start
npm test             # offline tests with a mocked model
npm run seed         # reset state to the sample artworks
```

Requires the Claude Code CLI (`claude`) on PATH. Every model step goes through `callModel()` in
`server/llm.js` (`claude -p --output-format json`, `CLAUDECODE` removed from the env). Env: `CLAUDE_MODEL`
(default `sonnet`), `CLAUDE_TIMEOUT_MS`, `DATA_DIR`. State is stored in `data/state.json`; images in `data/images/`.

Walkthrough: **Prepare** (left) → type a task → tick suggested skills → **Use selected skills & analyse** →
click clusters (priority first) and accept/reject/correct → **Ask** the chatbot about an artwork or cluster and save a
decision → **Finish task & learn** → define a second task (now uses the reuse pipeline with Skills v2 / Knowledge v2).

## Design → code

| Process | Step | Code |
|---|---|---|
| 1 Prepare artwork data | tool_1 extract | `detectRegions` — server/process1.js |
| | model_1 generate~ | `describeArtwork` — server/process1.js |
| 2 Recommend clusters and labels | model_2 select | `suggestSkills` — server/process2.js |
| | human select | skill checkboxes, `POST /api/tasks/:id/skills` — public/app.js `taskView` |
| | tool_2 translate | `computeTextEmbeddings` → `textEmbeddings` — server/process2.js, server/embeddings.js |
| | tool_3 translate | `computeImageEmbeddings` → `imageEmbedding` — server/process2.js, server/embeddings.js |
| | model_3 assign | `assignClusters` — server/process2.js |
| | model_3 modify | `refineClusters` — server/process2.js |
| | model_3 generate~ | `describePatterns` — server/process2.js |
| | model_4 evaluate | `scoreLabels` — server/process2.js |
| | model_4 select | `selectLabels` — server/process2.js |
| | model_4 generate~ | `writeRationales` — server/process2.js |
| | model_4 evaluate | `scorePriorities` — server/process2.js |
| | model_4 select | `selectPriorityClusters` — server/process2.js |
| 3 Review and confirm | human select | cluster card click — public/app.js `clustersPanel` |
| | human evaluate | accept / unsure / reject + comment — public/app.js `reviewPanel` |
| | human assign | confirmed-label chips + taxonomy picker, `POST /api/tasks/:id/review` |
| | tool_4 extract | `extract` — server/logs.js |
| 4 Chatbot | human select | focus picker / "Ask chatbot about this …" — public/app.js `chatPanel`, `artworkModal` |
| | human specify | question box |
| | model_5 generate~ | `chatAnswer` — server/process4.js |
| | human evaluate | agree / unsure / disagree — public/app.js `chatRound` |
| | human assign | label chips, `POST /api/tasks/:id/chat/:rid/decision` |
| | tool_4 expand | `expand` — server/logs.js |
| 5 Distill skills | model_6 extract | `mineBehaviors` — server/process5.js |
| | model_7 generate~ | `generateSkills` — server/process5.js |
| | model_8 match | `matchSkills` — server/process5.js |
| | model_8 evaluate | `diffSkills` — server/process5.js |
| | model_8 modify~ | `updateLibrary` — server/process5.js |
| 6 Accumulate knowledge | model_9 extract~ | `summarizeTask` — server/process6.js |
| | model_10 modify | `integrateKnowledge` — server/process6.js |
| 7 Reuse in a later task | model_2 select, human select | as in process 2 |
| | model_3 assign → generate, model_4 evaluate → select → generate | `runReusePipeline` — server/process2.js |

Processes 5 and 6 run together from `runLearning` in server/index.js.
