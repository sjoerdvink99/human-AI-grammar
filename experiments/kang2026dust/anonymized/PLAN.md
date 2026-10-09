# PLAN — System X

The design (`design.json`) has four processes but no goal, no descriptions, no
representation descriptions, no references and no images. Every identifier's
meaning therefore had to be inferred from the structure alone. The
interpretation below is my recommended default; per the experiment
instructions it is taken without waiting for confirmation.

## Interpretation

The structure reads as **data-grounded reflective journaling**:

* a collection of records (`r1*`) is the user's personal data log (one record per day:
  sleep, steps, heart rate, mood, events, places);
* a tool picks one record (`r2`) — the day to reflect on;
* a model generates a list of reflection questions (`r3*`) grounded in that record;
* the human writes a free-text response (`r4`);
* a model composes a journal entry (`r5`) from the record, the questions and the response.

Process 2 re-composes the entry in a chosen **style** (`r6` categorical → `r7`).
Process 3 lets the user describe another day in words (`r8`); a tool finds the
matching record (`r2_2`) and the model generates new questions (`r3_2`).
Process 4 is a data explorer: pick a metric (`r9`), a tool lists every day's
record for that metric (`r10*`), the user picks one (`r11`), a tool renders it as a chart (`r12`).

## Stack (repository was empty)

* Node 20, Express, plain ES modules — no build step.
* Front end: one static page (`public/`), vanilla JS, hand-written SVG charts.
* Model: Claude Code CLI (`claude -p --output-format json`, CLAUDECODE removed) behind
  `callModel()` in `server/llm.js`.
* Tests: `node --test`.
* Persistence: data in `data/records.json`; session state (versions, entries) in browser `localStorage`.

## Representations

| id | type | contents | file |
| --- | --- | --- | --- |
| r1 `records` | artifact record* | `DayRecord[]`: `{id, date, weekday, sleep_hours, steps, steps_hourly[24], resting_hr, hr_hourly[24], mood(1-5), events[], places[], weather}` | `data/records.json`, `server/records.js` |
| r2 `focusRecord` | artifact record | one `DayRecord`; versions r2_1 (P1 pick), r2_2 (P3 search) | `public/app.js` state |
| r3 `prompts` | artifact language* | 3–5 reflection questions, each ≤ 200 chars; versions r3_1, r3_2 kept as rounds | `server/operations.js`, `public/app.js` |
| r4 `response` | artifact language | user's free text (required, non-empty) | textarea in `public/index.html` |
| r5 `entry` | artifact language | composed first-person journal entry | `server/operations.js` |
| r6 `style` | instruction categorical | one of `poem, letter_to_future_self, short_story, bullet_summary, gratitude_note` | `server/operations.js` STYLES |
| r7 `restyledEntry` | artifact language | entry rewritten in style r6 | `server/operations.js` |
| r8 `dayQuery` | instruction language | free-text description of a day | input in `public/index.html` |
| r9 `metric` | selection categorical | one of `sleep, steps, heart_rate, mood` | `server/tools.js` METRICS |
| r10 `metricRecords` | artifact record* | `{id, date, metric, value, unit}` per day | `server/tools.js` |
| r11 `chosenMetricRecord` | selection record | one r10 item | `public/app.js` state |
| r12 `chart` | artifact visual | SVG chart (hourly bars / line, or value vs. all days) | `server/tools.js` (spec) + `public/chart.js` (SVG) |

## Transformations

| process | step | function / component | file |
| --- | --- | --- | --- |
| P1 | [tool select] r1* → r2_1 | `selectFocusRecord()` (latest day) → `GET /api/focus` | `server/tools.js` |
| P1 | [model generate]~ r1*+r2 → r3_1* | `generatePrompts()` → `POST /api/prompts` | `server/operations.js` |
| P1 | [human generate] → r4 | "Your reflection" textarea | `public/index.html` |
| P1 | [model compose]~ r2+r3+r4 → r5 | `composeEntry()` → `POST /api/compose` | `server/operations.js` |
| P2 | [human specify] → r6 | style buttons | `public/index.html` |
| P2 | [model compose]~ r2+r4+r5+r6 → r7 | `restyleEntry()` → `POST /api/restyle` | `server/operations.js` |
| P3 | [human specify] → r8 | "Reflect on another day" input | `public/index.html` |
| P3 | [tool select] r1*+r8 → r2_2 | `searchRecord()` (keyword + date scoring) → `POST /api/search` | `server/tools.js` |
| P3 | [model generate]~ r2_2+r8 → r3_2* | `generatePrompts()` with query → `POST /api/prompts` | `server/operations.js` |
| P4 | [human select] → r9 | metric toggle buttons | `public/index.html` |
| P4 | [tool select] r1*+r9 → r10* | `metricRecords()` → `GET /api/metric/:metric` | `server/tools.js` |
| P4 | [human select] → r11 | click a row in the metric list | `public/app.js` |
| P4 | [tool translate] r11 → r12 | `chartSpec()` → `GET /api/chart/:metric/:id`, rendered by `renderChart()` | `server/tools.js`, `public/chart.js` |

## Images

None in the design.

## Open choices (default taken)

* Domain: personal-data journaling (inferred, see above).
* Model provider: Claude Code CLI, one `callModel()` function.
* Persistence: local JSON dataset + browser localStorage.
* Layout: three-column workspace — data (r1/P4) left, reflection flow (P1/P3) centre, entry & styles (P2) right.
