import express from 'express';
import { loadRecords } from './records.js';
import { selectFocusRecord, searchRecord, metricRecords, chartSpec, METRICS } from './tools.js';
import { generatePrompts, composeEntry, restyleEntry, STYLES } from './operations.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(new URL('../public', import.meta.url).pathname));

const records = loadRecords();
const byId = (id) => {
  const r = records.find((x) => x.id === id);
  if (!r) throw Object.assign(new Error(`Unknown record ${id}`), { status: 400 });
  return r;
};
const text = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) throw Object.assign(new Error(`${name} is required`), { status: 400 });
  return v.trim();
};
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

// r1 and vocabularies
app.get('/api/records', wrap(() => ({ records, metrics: METRICS, styles: Object.keys(STYLES) })));

// P1 [tool select] r1* -> r2_1
app.get('/api/focus', wrap(() => ({ record: selectFocusRecord(records) })));

// P1 [model generate]~ r1*+r2_1 -> r3_1*   |   P3 [model generate]~ r5+r2_2+r8 -> r3_2*
app.post('/api/prompts', wrap(async (req) => {
  const { recordId, query, entry } = req.body;
  const record = byId(recordId);
  const prompts = query
    ? await generatePrompts({ record, query: text(query, 'query'), entry: entry || undefined })
    : await generatePrompts({ records, record });
  return { prompts };
}));

// P1 [model compose]~ r1*+r2+r3*+r4 -> r5
app.post('/api/compose', wrap(async (req) => {
  const { recordId, prompts, response } = req.body;
  if (!Array.isArray(prompts) || !prompts.length) throw Object.assign(new Error('prompts are required'), { status: 400 });
  return composeEntry({ records, record: byId(recordId), prompts, response: text(response, 'response') });
}));

// P2 [model compose]~ r2+r4+r5+r6 -> r7
app.post('/api/restyle', wrap(async (req) => {
  const { recordId, response, entry, style } = req.body;
  if (!STYLES[style]) throw Object.assign(new Error('style must be one of ' + Object.keys(STYLES).join(', ')), { status: 400 });
  return restyleEntry({ record: byId(recordId), response: text(response, 'response'), entry: text(entry, 'entry'), style });
}));

// P3 [tool select] r1*+r8 -> r2_2
app.post('/api/search', wrap((req) => searchRecord(records, text(req.body.query, 'query'))));

// P4 [tool select] r1*+r9 -> r10*
app.get('/api/metric/:metric', wrap((req) => ({ items: metricRecords(records, req.params.metric) })));

// P4 [tool translate] r11 -> r12
app.get('/api/chart/:metric/:id', wrap((req) => ({ chart: chartSpec(records, req.params.metric, req.params.id) })));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`System X journal running at http://localhost:${port}`));
