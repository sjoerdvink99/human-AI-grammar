// Client state. Names follow the design identifiers:
//   r1 records, r2 focus (versions), r3 prompts (rounds), r4 response, r5 entry,
//   r6 style, r7 restyled, r8 query, r9 metric, r10 metricItems, r11 chosen, r12 chart
import { renderChart } from './chart.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'daybook-state-v1';

const meta = { records: [], metrics: {}, styles: [] }; // r1 + vocabularies
let state = load() || fresh();
const busy = new Set();
let metricItems = []; // r10*
let chart = null; // r12

function fresh() {
  return {
    focus: [], // r2 versions: {version, record, via, query?, reasons?}
    rounds: [], // r3 versions: {version, recordId, query?, prompts[], response}  (response = r4 for that round)
    activeRound: -1,
    entries: [], // r5 versions: {version, recordId, round, title, entry, response}
    activeEntry: -1,
    restyles: [], // r7: {entryVersion, style, text}
    metric: null, // r9
    chosenId: null, // r11
  };
}
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 5000); }
async function run(key, fn) {
  if (busy.has(key)) return;
  busy.add(key); render();
  try { await fn(); } catch (e) { toast(e.message); } finally { busy.delete(key); save(); render(); }
}

const focus = () => state.focus.at(-1);
const round = () => state.rounds[state.activeRound];
const entry = () => state.entries[state.activeEntry];

// ---------- Process 1 ----------
// [tool select] r1* -> r2_1
async function selectFocus() {
  const { record } = await api('/api/focus');
  state.focus.push({ version: state.focus.length + 1, record, via: 'latest day' });
}
// [model generate]~ r1* + r2 -> r3*   (P3 variant adds r8 query and r5 entry)
async function generatePrompts({ query, replace } = {}) {
  const f = focus();
  const { prompts } = await api('/api/prompts', { recordId: f.record.id, query, entry: query ? entry()?.entry : undefined });
  if (replace && round()) {
    round().prompts = prompts;
  } else {
    state.rounds.push({ version: state.rounds.length + 1, recordId: f.record.id, query, prompts, response: '' });
    state.activeRound = state.rounds.length - 1;
  }
}
// [model compose]~ r1* + r2 + r3* + r4 -> r5
async function compose() {
  const r = round();
  const res = await api('/api/compose', { recordId: r.recordId, prompts: r.prompts, response: r.response });
  state.entries.push({ version: state.entries.length + 1, recordId: r.recordId, round: r.version, response: r.response, ...res });
  state.activeEntry = state.entries.length - 1;
}

// ---------- Process 2 ----------
// [human specify] r6 then [model compose]~ r2 + r4 + r5 + r6 -> r7
async function restyle(style) {
  const e = entry();
  const { text } = await api('/api/restyle', { recordId: e.recordId, response: e.response, entry: e.entry, style });
  state.restyles.push({ entryVersion: e.version, style, text });
}

// ---------- Process 3 ----------
// [human specify] r8, [tool select] r1* + r8 -> r2_2, [model generate]~ r5 + r2_2 + r8 -> r3_2*
async function searchDay(query) {
  const res = await api('/api/search', { query });
  state.focus.push({ version: state.focus.length + 1, record: res.record, via: 'search', query, reasons: res.reasons });
  render();
  await generatePrompts({ query });
}

// ---------- Process 4 ----------
// [human select] r9, [tool select] r1* + r9 -> r10*
async function chooseMetric(metric) {
  state.metric = metric; state.chosenId = null; chart = null;
  metricItems = (await api(`/api/metric/${metric}`)).items;
}
// [human select] r11, [tool translate] r11 -> r12
async function chooseMetricRecord(id) {
  state.chosenId = id;
  chart = (await api(`/api/chart/${state.metric}/${encodeURIComponent(id)}`)).chart;
}

// ---------- Rendering ----------
const spinner = (on, label) => (on ? `<p class="loading"><span class="spin"></span>${esc(label)}</p>` : '');
const recordById = (id) => meta.records.find((r) => r.id === id);

function render() {
  $('r1-count').textContent = `${meta.records.length} days`;
  const hasEntry = !!entry();

  // r2 focus record
  const f = focus();
  $('focus').innerHTML = f
    ? `<div class="focus-head"><strong>${esc(f.record.weekday)} ${esc(f.record.date)}</strong>
         <span class="tag">r2 v${f.version} · ${esc(f.via)}</span></div>
       ${f.query ? `<p class="muted small">Matched “${esc(f.query)}” ${f.reasons?.length ? '— ' + esc(f.reasons.join(', ')) : ''}</p>` : ''}
       <dl class="facts">
         <div><dt>Sleep</dt><dd>${f.record.sleep_hours} h</dd></div>
         <div><dt>Steps</dt><dd>${f.record.steps.toLocaleString()}</dd></div>
         <div><dt>Resting HR</dt><dd>${f.record.resting_hr} bpm</dd></div>
         <div><dt>Mood</dt><dd>${'●'.repeat(f.record.mood)}${'○'.repeat(5 - f.record.mood)}</dd></div>
         <div class="wide"><dt>Events</dt><dd>${esc(f.record.events.join(', ') || '—')}</dd></div>
         <div class="wide"><dt>Places</dt><dd>${esc(f.record.places.join(', '))} · ${esc(f.record.weather)}</dd></div>
       </dl>`
    : spinner(true, 'Selecting a day…');

  // P3 controls (need r5)
  $('search-form').hidden = !hasEntry;
  $('search-gate').hidden = hasEntry;
  $('search-form').querySelector('button').disabled = busy.has('search');

  // r3 rounds
  $('rounds').innerHTML = state.rounds
    .map((r, i) => `<button class="chip ${i === state.activeRound ? 'on' : ''}" data-round="${i}" title="${esc(r.query ? 'From: ' + r.query : 'Initial')}">Round ${r.version} · ${esc(recordById(r.recordId)?.date.slice(5) || '')}</button>`)
    .join('');
  const r = round();
  const genBusy = busy.has('prompts') || busy.has('search');
  $('prompts').innerHTML = genBusy
    ? `<li class="plain">${spinner(true, busy.has('search') ? 'Finding the day and writing new questions…' : 'Writing reflection questions…')}</li>`
    : r ? r.prompts.map((p) => `<li>${esc(p)}</li>`).join('') : '';
  $('regen').disabled = !r || genBusy;

  // r4 response
  const ta = $('response');
  if (document.activeElement !== ta) ta.value = r?.response || '';
  ta.disabled = !r;
  $('compose').disabled = !r || !r.response.trim() || busy.has('compose') || genBusy;
  $('compose').textContent = busy.has('compose') ? 'Composing…' : 'Compose journal entry';

  // r5 entry
  const e = entry();
  $('entry').innerHTML = busy.has('compose')
    ? spinner(true, 'Composing your entry…')
    : e
      ? `<div class="focus-head"><h3>${esc(e.title)}</h3><span class="tag">r5 v${e.version} · ${esc(recordById(e.recordId)?.date)}</span></div>${paras(e.entry)}`
      : '<p class="muted">Your composed entry will appear here.</p>';
  $('entry-history').innerHTML = state.entries.length > 1
    ? state.entries.map((x, i) => `<button class="chip ${i === state.activeEntry ? 'on' : ''}" data-entry="${i}">Entry ${x.version}</button>`).join('')
    : '';

  // P2
  $('p2').hidden = !hasEntry;
  $('style-buttons').innerHTML = meta.styles
    .map((s) => `<button class="chip" data-style="${s}" ${busy.size ? 'disabled' : ''}>${esc(s.replace(/_/g, ' '))}</button>`)
    .join('');
  const rs = state.restyles.filter((x) => e && x.entryVersion === e.version).reverse();
  $('restyled').innerHTML = (busy.has('restyle') ? spinner(true, 'Rewriting…') : '') +
    rs.map((x) => `<article class="card restyled"><div class="focus-head"><strong>${esc(x.style.replace(/_/g, ' '))}</strong><span class="tag">r7</span></div>${paras(x.text)}</article>`).join('');

  // P4 (needs r5)
  $('p4').hidden = !hasEntry;
  $('p4-gate').hidden = hasEntry;
  $('metric-buttons').innerHTML = Object.entries(meta.metrics)
    .map(([k, m]) => `<button class="chip ${state.metric === k ? 'on' : ''}" data-metric="${k}">${esc(m.label)}</button>`)
    .join('');
  const max = Math.max(1, ...metricItems.map((i) => i.value));
  $('metric-list').innerHTML = busy.has('metric') ? `<li>${spinner(true, 'Loading…')}</li>` : metricItems
    .slice().reverse()
    .map((i) => `<li class="${i.id === state.chosenId ? 'on' : ''} ${i.id === f?.record.id ? 'focus' : ''}" data-id="${esc(i.id)}" tabindex="0">
        <span class="d">${esc(i.weekday.slice(0, 3))} ${esc(i.date.slice(5))}</span>
        <span class="bar-wrap"><span class="b" style="width:${(i.value / max) * 100}%"></span></span>
        <span class="v">${i.value.toLocaleString()} ${esc(i.unit)}</span></li>`)
    .join('');
  $('chart').innerHTML = busy.has('chart') ? spinner(true, 'Drawing…') : chart ? renderChart(chart) : state.metric ? '<p class="muted small">Pick a day to chart it.</p>' : '<p class="muted small">Pick a metric.</p>';
}
const paras = (t) => t.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('');

// ---------- Events ----------
$('response').addEventListener('input', (ev) => {
  if (!round()) return;
  round().response = ev.target.value; // [human generate] -> r4
  save();
  $('compose').disabled = !ev.target.value.trim() || busy.size > 0;
});
$('compose').addEventListener('click', () => run('compose', compose));
$('regen').addEventListener('click', () => run('prompts', () => generatePrompts({ query: round()?.query, replace: true })));
$('rounds').addEventListener('click', (ev) => {
  const i = ev.target.closest('[data-round]')?.dataset.round;
  if (i == null) return;
  state.activeRound = Number(i); save(); render();
});
$('entry-history').addEventListener('click', (ev) => {
  const i = ev.target.closest('[data-entry]')?.dataset.entry;
  if (i == null) return;
  state.activeEntry = Number(i); save(); render();
});
$('style-buttons').addEventListener('click', (ev) => {
  const s = ev.target.closest('[data-style]')?.dataset.style;
  if (s) run('restyle', () => restyle(s));
});
$('search-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = $('query').value.trim();
  if (!q) return toast('Describe the day you want to reflect on.');
  run('search', () => searchDay(q)).then(() => { if (focus()?.query === q) $('query').value = ''; });
});
$('metric-buttons').addEventListener('click', (ev) => {
  const m = ev.target.closest('[data-metric]')?.dataset.metric;
  if (m) run('metric', () => chooseMetric(m));
});
const pickRow = (ev) => {
  const id = ev.target.closest('[data-id]')?.dataset.id;
  if (id) run('chart', () => chooseMetricRecord(id));
};
$('metric-list').addEventListener('click', pickRow);
$('metric-list').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickRow(ev); } });
$('reset').addEventListener('click', () => {
  if (!confirm('Clear all rounds and entries?')) return;
  state = fresh(); metricItems = []; chart = null; save(); start();
});

// ---------- Start: Process 1 runs automatically ----------
async function start() {
  render();
  if (!state.focus.length) await run('focus', selectFocus);
  if (!state.rounds.length) await run('prompts', () => generatePrompts());
  if (state.metric && entry()) {
    await run('metric', () => chooseMetric(state.metric));
  }
}
(async () => {
  try { Object.assign(meta, await api('/api/records')); } catch (e) { toast(e.message); }
  start();
})();
