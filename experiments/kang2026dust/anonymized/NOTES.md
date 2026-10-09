# NOTES — decisions the design did not determine

The design gave only four structural expressions. It had no goal, no system or process
descriptions, no representation descriptions, no references and no images, and the
identifiers were opaque (`r1`…`r12`). So everything except the step structure was my choice.

## Domain and meaning of each representation

| id | Design gives | What I chose |
| --- | --- | --- |
| r1 | artifact record* | Personal-data log, one record per day: sleep, steps (with an hourly series), resting HR (with an hourly series), mood 1–5, calendar events, places, weather |
| r2 | artifact record | The "focus day" to reflect on |
| r3 | artifact language* | 3–5 (I ask for 4) open reflection questions that refer to the day's data |
| r4 | artifact language (human generate) | The user's free-text reflection |
| r5 | artifact language (model compose) | A first-person journal entry of 120–220 words, plus a title |
| r6 | instruction categorical | A rewrite style: poem, letter to future self, short story, bullet summary, gratitude note |
| r7 | artifact language | The entry rewritten in that style |
| r8 | instruction language | A free-text description of another day ("the hiking trip", "when I slept worst", "Nov 3") |
| r9 | selection categorical | A metric: sleep, steps, heart rate, mood |
| r10 | artifact record* | Per-day `{id, date, weekday, metric, value, unit}` for that metric |
| r11 | selection record | One r10 item, picked from the list |
| r12 | artifact visual | An SVG chart: hourly bars (steps) or line (heart rate); for sleep and mood, a bar for every day with the chosen day highlighted |

## Process logic and triggers

- **P1 trigger:** runs automatically on page load. The tool step picks the most recent day; question generation starts right after.
- **P1 tool select rule:** "latest day". I could also have picked a random day, a day not yet reflected on, or an unusual day.
- **P3 and P4 gating:** both start from r5, so they stay locked (shown as dashed placeholders) until an entry exists.
- **P3 tool select:** a deterministic scorer in `searchRecord`, not a model. It scores ISO and month-day dates, "today"/"yesterday", weekdays and "weekend", keyword stems matched against events, places and weather, and superlative phrases ("slept worst", "most steps", "happiest", "stressful"). If nothing scores, it returns an error. Ties go to the most recent day.
- **P3 model step:** the prompt contains only r5 (the previous entry), r2_2 and r8. Following the state, it leaves out the r1 baseline.
- **P2 model step:** the prompt contains r2, r4, r5 and r6. It does not get the r3 questions, matching the state.
- **Continuing after P3:** P3 ends with new questions (r3_2). The UI then lets the user write a new reflection and compose again, which re-enters P1's human generate and model compose steps on the new day. **The design does not state this.** I allowed it because the shared UI makes it natural.
- **Versions:** every r2 version (`focus[]`) and r3 round (`rounds[]`) is kept. Each round has its own r4 response. Every r5 entry is kept (Entry 1, Entry 2… chips). Every r7 is kept under the entry it rewrote. Earlier rounds can be reopened with the round chips.
- **Regeneration (`~`):** "↻ Regenerate" replaces the active round's questions; it does not add a round. Restyling to the same style again adds another r7. There is no explicit accept step before results are committed, because no human evaluate step follows them in the design.
- **Validation of model output:** the model must return a JSON object, which is validated in `server/operations.js`. Questions: an array of 3+ non-empty strings, cut to 5 items and 240 characters. Entry: non-empty title and entry. Restyle: non-empty text. One retry on invalid output, then an error toast.
- **Input validation:** the server rejects an empty r4, an empty r8, an unknown r6 style, an unknown r9 metric and an unknown record id.

## Model prompts

- One shared system prompt: "thoughtful journaling companion; use only facts present in the data and writing; never invent events, people or places; reply with one JSON object."
- `generatePrompts` asks for 4 open, data-specific questions under 200 characters each. Optional sections: usual patterns (P1), the user's description of the day (P3), and the previous entry for continuity (P3).
- `composeEntry` asks for a 120–220-word first-person entry. The user's reflection is the primary source and keeps their voice; the questions are guidance only.
- `restyleEntry` asks for a rewrite in the given style description, keeping the facts consistent and adding no events.
- Records go to the model as compact text from `describeRecord`. Hourly arrays are reduced to peak hours.

## Provider

- `callModel(prompt, {system})` in `server/llm.js` is the only provider seam.
- It runs `claude -p --output-format json --append-system-prompt …`, sends the prompt on stdin, deletes `CLAUDECODE` from the environment, times out after 180 s and reads the `result` field.
- `callModelJSON` adds JSON extraction (including fenced blocks), validation and one retry.

## Stack, data and persistence

- Node 20 + Express. Static vanilla-JS front end with no build step. Charts are hand-written SVG; no chart library. Tests use `node --test`, plus a headless Playwright walk-through I ran outside the repo; it is not part of the repo.
- Data is 42 synthetic days in `data/records.json`, made by a seeded generator (`scripts/seed.js`). There is no upload or import of real data.
- Session state (versions, rounds, entries, restyles, chosen metric) is saved in browser `localStorage`. "Start over" clears it. The server is stateless.

## Layout and styling

- Three columns: data explorer (P4) on the left, reflection flow (P1/P3) in the middle, entry and rewrites (P1 output, P2) on the right. Below 1100 px they stack into one column.
- Warm paper palette with a teal accent and an orange highlight. Serif for prose, sans-serif for controls.
- The focus day is a card of facts; mood is shown as filled dots.
- Small version tags (`r2 v2 · search`, `r5 v1`, `r7`) keep the design identifiers visible.
- The metric list is a table of days with inline bars. The focus day has a ★, and the chosen row is highlighted.
- Spinners show while model calls run, and errors appear as a toast.
- The product name "Daybook" is my invention.

## Did the design remind me of a published system?

Yes, partly. The structure most reminded me of **MindScape** (Nepal et al., CHI/IMWUT 2024). It is a journaling app that combines behavioural data from phone sensing with an LLM to generate context-aware journaling prompts. More broadly, it reminded me of LLM-supported reflection work in personal informatics.

These choices came from that knowledge rather than from the design:

- reading r1 as **personal behavioural data** (sleep, steps, heart rate, places, calendar)
- reading r3 as **reflection or journaling prompts** generated from that data, and r4 as the user's journal response
- the **data explorer with charts** in P4, as a "look at the data behind your reflection" view

As far as I recall, MindScape does not have these features, so I designed them myself from the structure:

- composing a journal entry (r5)
- restyling it into poem, letter and so on (r6/r7)
- selecting a day by free-text description (r8 → r2_2)

I did not look up the original system.
