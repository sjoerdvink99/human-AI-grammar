// Client state is named after the design identifiers (without version where it is a single slot).
import hljs from '/vendor/hljs/es/core.min.js';
import python from '/vendor/hljs/es/languages/python.min.js';
hljs.registerLanguage('python', python);

const state = {
  r1: null,          // dataset record {name, format, content}
  r2: [],            // guideline library (instruction record*)
  r3_1: '',          // original request
  r4: null,          // data profile
  r5: [],            // matched guidelines (selection record*)
  rounds: [],        // refinement rounds: [{r3_2, r6}] — earlier rounds kept for comparison
  activeRound: -1,
  r3_2: null,        // refined request the human selected
  r7: null,          // generated code
  r8: [],            // suggested guidelines (r8_1, edited in place -> r8_2)
  r9: new Set(),     // indexes of ticked suggestions
  r10: new Set(),    // selected library guideline ids
  editing: null,     // library guideline id being edited (or 'new')
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showError(msg) {
  const el = $('#error');
  el.hidden = !msg;
  el.textContent = msg || '';
}

function setStep(step, status) {
  const li = document.querySelector(`#steps li[data-step="${step}"]`);
  li.className = status || '';
}
function resetSteps(from) {
  const order = ['extract', 'match', 'refine', 'select', 'code'];
  for (const s of order.slice(order.indexOf(from))) setStep(s, '');
}

// ---------------------------------------------------------------------------
// r1: dataset loading
async function setDataset(name, content) {
  const format = name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  state.r1 = { name, format, content };
  state.r4 = null;
  $('#dataset-info').innerHTML = `<strong>${esc(name)}</strong> · ${format.toUpperCase()} · ${(content.length / 1024).toFixed(1)} KB`;
  $('#profile-box').hidden = true;
  updateRunHint();
}
$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) setDataset(f.name, await f.text());
});
$('#load-sample').addEventListener('click', async () => {
  const text = await (await fetch('/samples/orders.csv')).text();
  setDataset('orders.csv', text);
  if (!$('#request').value) $('#request').value = 'Which region brings in the most revenue per month, and how satisfied are its customers?';
  updateRunHint();
});

function renderProfile() {
  const r4 = state.r4;
  if (!r4) return;
  $('#profile-box').hidden = false;
  $('#dataset-info').innerHTML = `<strong>${esc(r4.name)}</strong> · ${r4.rowCount} rows · ${r4.columns.length} columns`;
  $('#profile').innerHTML = `<table class="profile"><thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Unique</th><th>Range / examples</th></tr></thead><tbody>${r4.columns
    .map((c) => {
      const range = c.min !== undefined ? `${esc(c.min)} – ${esc(c.max)}` : esc(c.examples.slice(0, 3).join(', '));
      const missPct = r4.rowCount ? (100 * c.missing) / r4.rowCount : 0;
      return `<tr><td>${esc(c.name)}</td><td><span class="badge">${c.type}</span></td>
        <td><span class="bar"><span style="width:${missPct}%"></span></span> ${c.missing}</td>
        <td>${c.unique}</td><td class="muted">${range}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// r2: library (processes 3 and 4)
async function loadLibrary() {
  state.r2 = (await api('/api/library')).r2;
  renderLibrary();
}

function renderLibrary() {
  const box = $('#library');
  box.innerHTML = '';
  const matched = new Map(state.r5.map((m) => [m.guideline_id, m]));
  for (const id of [...state.r10]) if (!state.r2.some((g) => g.id === id)) state.r10.delete(id);
  if (state.editing === 'new') box.appendChild(editForm({ title: '', when: '', instruction: '' }, 'new'));
  for (const g of state.r2) {
    if (state.editing === g.id) { box.appendChild(editForm(g, g.id)); continue; }
    const el = $('#guideline-tpl').content.firstElementChild.cloneNode(true);
    el.dataset.id = g.id;
    el.querySelector('.g-title').textContent = g.title;
    el.querySelector('.src').textContent = g.source;
    el.querySelector('.g-when').textContent = g.when ? `When: ${g.when}` : 'When: always';
    el.querySelector('.g-instruction').textContent = g.instruction;
    const cb = el.querySelector('.g-select');
    cb.checked = state.r10.has(g.id);
    cb.addEventListener('change', () => { cb.checked ? state.r10.add(g.id) : state.r10.delete(g.id); renderSelection(); el.classList.toggle('selected', cb.checked); });
    el.classList.toggle('selected', cb.checked);
    if (matched.has(g.id)) {
      el.classList.add('matched');
      const m = el.querySelector('.g-match');
      m.hidden = false;
      m.textContent = `Matched: ${matched.get(g.id).reason}`;
    }
    el.querySelector('.g-edit').addEventListener('click', () => { state.editing = g.id; renderLibrary(); });
    el.querySelector('.g-delete').addEventListener('click', async () => {
      if (!confirm(`Delete guideline "${g.title}"?`)) return;
      state.r2 = (await api(`/api/library/${g.id}`, undefined, 'DELETE')).r2;
      renderLibrary();
    });
    box.appendChild(el);
  }
  if (!state.r2.length && state.editing !== 'new') box.innerHTML = '<p class="muted">The library is empty.</p>';
  renderSelection();
}

function editForm(g, id) {
  const f = document.createElement('form');
  f.className = 'guideline editing';
  f.innerHTML = `
    <label>Title<input name="title" maxlength="120" required value="${esc(g.title)}"></label>
    <label>Applies when<input name="when" value="${esc(g.when)}" placeholder="always"></label>
    <label>Instruction<textarea name="instruction" rows="3" required>${esc(g.instruction)}</textarea></label>
    <div class="row"><button class="btn small primary">Save</button><button type="button" class="btn small ghost cancel">Cancel</button><span class="error-inline"></span></div>`;
  f.querySelector('.cancel').addEventListener('click', () => { state.editing = null; renderLibrary(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    try {
      state.r2 = (id === 'new' ? await api('/api/library', body) : await api(`/api/library/${id}`, body, 'PUT')).r2;
      state.editing = null;
      renderLibrary();
    } catch (err) {
      f.querySelector('.error-inline').textContent = err.message;
    }
  });
  return f;
}

$('#add-guideline').addEventListener('click', () => { state.editing = 'new'; renderLibrary(); });

// Process 4: r2_2 -> r10 (selection)
function renderSelection() {
  $('#selection-count').innerHTML = `${state.r10.size} selected <small class="rid">r10</small>`;
  $('#export-selected').disabled = state.r10.size === 0;
}
$('#select-all').addEventListener('click', () => { state.r2.forEach((g) => state.r10.add(g.id)); renderLibrary(); });
$('#select-none').addEventListener('click', () => { state.r10.clear(); renderLibrary(); });
$('#export-selected').addEventListener('click', () => {
  const r10 = state.r2.filter((g) => state.r10.has(g.id));
  download('guidelines.json', JSON.stringify(r10, null, 2), 'application/json');
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Process 1
function updateRunHint() {
  const ok = state.r1 && $('#request').value.trim();
  $('#run').disabled = !ok;
  $('#run-hint').textContent = !state.r1 ? 'Load a dataset first.' : !ok ? 'Write a request.' : '';
}
$('#request').addEventListener('input', updateRunHint);

let busy = false;
async function withBusy(fn) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  showError('');
  try { await fn(); } catch (e) { showError(e.message); } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

// [human specify] -> r3_1, then tool_1 extract, model_1 match, model_2 modify run automatically.
$('#run').addEventListener('click', () => withBusy(async () => {
  state.r3_1 = $('#request').value.trim();
  Object.assign(state, { r4: null, r5: [], rounds: [], activeRound: -1, r3_2: null, r7: null, r8: [] });
  state.r9.clear();
  for (const id of ['#match-panel', '#refine-panel', '#code-panel', '#suggest-panel']) $(id).hidden = true;
  $('#suggestions').innerHTML = '';
  $('#compose-row').hidden = true;
  resetSteps('extract');

  await step('extract', async () => { state.r4 = (await api('/api/extract', { r1: state.r1 })).r4; renderProfile(); });
  await step('match', async () => { state.r5 = (await api('/api/match', { r4: state.r4, r3_1: state.r3_1 })).r5; renderMatches(); renderLibrary(); });
  $('#suggest-panel').hidden = false; // process 2 can start once r5 exists
  await refine();
}));

async function step(name, fn) {
  setStep(name, 'running');
  try { await fn(); setStep(name, 'done'); } catch (e) { setStep(name, 'failed'); throw e; }
}

function renderMatches() {
  $('#match-panel').hidden = false;
  const byId = new Map(state.r2.map((g) => [g.id, g]));
  $('#matches').innerHTML = state.r5.length
    ? state.r5.map((m) => `<li><strong>${esc(byId.get(m.guideline_id)?.title || m.guideline_id)}</strong><span class="muted"> — ${esc(m.reason)}</span></li>`).join('')
    : '<li class="muted">No guideline in the library applies to this request.</li>';
}

// model_2 modify~: produces a new round (r3_2 + r6); earlier rounds stay available.
async function refine() {
  resetSteps('refine');
  await step('refine', async () => {
    const round = await api('/api/refine', { r4: state.r4, r3_1: state.r3_1, r5: state.r5 });
    state.rounds.push(round);
    state.activeRound = state.rounds.length - 1;
    renderRefinement();
  });
  setStep('select', 'waiting');
}
$('#regen-refined').addEventListener('click', () => withBusy(refine));

function renderRefinement() {
  $('#refine-panel').hidden = false;
  const round = state.rounds[state.activeRound];
  $('#refine-tabs').innerHTML = state.rounds.length > 1
    ? state.rounds.map((_, i) => `<button class="tab ${i === state.activeRound ? 'active' : ''}" data-i="${i}">Version ${i + 1}</button>`).join('')
    : '';
  $('#refine-tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { state.activeRound = +b.dataset.i; renderRefinement(); }));
  $('#original-text').textContent = state.r3_1;
  $('#refined-text').textContent = round.r3_2;
  const byId = new Map(state.r2.map((g) => [g.id, g]));
  const label = { applied: 'Applied', partially_applied: 'Partly applied', not_applicable: 'Not applied' };
  $('#evaluations').innerHTML = round.r6.length
    ? round.r6.map((e) => `<li><span class="verdict ${e.verdict}">${label[e.verdict]}</span> <strong>${esc(byId.get(e.guideline_id)?.title || e.guideline_id)}</strong><div class="muted">${esc(e.note)}</div></li>`).join('')
    : '<li class="muted">No guidelines were matched, so the refinement only made the request self-contained.</li>';
}

// [human select] -> r3_2, then model_4 generate~ -> r7
$('#accept-refined').addEventListener('click', () => withBusy(async () => {
  state.r3_2 = state.rounds[state.activeRound].r3_2;
  setStep('select', 'done');
  await generateCode();
}));
$('#regen-code').addEventListener('click', () => withBusy(generateCode));

async function generateCode() {
  await step('code', async () => {
    state.r7 = (await api('/api/generate-code', { r3_2: state.r3_2 })).r7;
    $('#code-panel').hidden = false;
    const el = $('#code');
    el.textContent = state.r7.code;
    delete el.dataset.highlighted;
    hljs.highlightElement(el);
    $('#code-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
$('#copy-code').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.r7.code);
  $('#copy-code').textContent = 'Copied';
  setTimeout(() => ($('#copy-code').textContent = 'Copy'), 1200);
});
$('#download-code').addEventListener('click', () => download('analysis.py', state.r7.code, 'text/x-python'));

// ---------------------------------------------------------------------------
// Process 2: model_3 generate~ -> r8, human modify -> r8_2, human select -> r9, tool_2 compose -> r2_2
$('#suggest').addEventListener('click', () => withBusy(async () => {
  $('#suggest').textContent = 'Suggesting…';
  try {
    state.r8 = (await api('/api/suggest', { r3_1: state.r3_1, r4: state.r4, r5: state.r5 })).r8;
    state.r9 = new Set(state.r8.map((_, i) => i));
    renderSuggestions();
  } finally {
    $('#suggest').textContent = 'Suggest again';
  }
}));

function renderSuggestions() {
  const box = $('#suggestions');
  if (!state.r8.length) {
    box.innerHTML = '<p class="muted">No new guidelines suggested.</p>';
    $('#compose-row').hidden = true;
    return;
  }
  box.innerHTML = state.r8.map((s, i) => `
    <div class="suggestion ${state.r9.has(i) ? 'selected' : ''}" data-i="${i}">
      <label class="pick"><input type="checkbox" ${state.r9.has(i) ? 'checked' : ''}> Keep</label>
      <label>Title<input data-f="title" value="${esc(s.title)}" maxlength="120"></label>
      <label>Applies when<input data-f="when" value="${esc(s.when)}"></label>
      <label>Instruction<textarea data-f="instruction" rows="2">${esc(s.instruction)}</textarea></label>
      <div class="muted rationale">Why: ${esc(s.rationale)}</div>
    </div>`).join('');
  box.querySelectorAll('.suggestion').forEach((card) => {
    const i = +card.dataset.i;
    card.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => { state.r8[i][inp.dataset.f] = inp.value; }));
    card.querySelector('.pick input').addEventListener('change', (e) => {
      e.target.checked ? state.r9.add(i) : state.r9.delete(i);
      card.classList.toggle('selected', e.target.checked);
      renderComposeCount();
    });
  });
  $('#compose-row').hidden = false;
  renderComposeCount();
}
function renderComposeCount() {
  $('#compose-count').textContent = `${state.r9.size} of ${state.r8.length} selected`;
  $('#compose').disabled = state.r9.size === 0;
}

$('#compose').addEventListener('click', () => withBusy(async () => {
  const r9 = state.r8.filter((_, i) => state.r9.has(i));
  const { r2, added } = await api('/api/compose', { r9 });
  state.r2 = r2;
  state.r8 = state.r8.filter((_, i) => !state.r9.has(i));
  state.r9.clear();
  renderSuggestions();
  renderLibrary();
  for (const id of added) document.querySelector(`.guideline[data-id="${id}"]`)?.classList.add('new');
  $('#compose-count').textContent = `${added.length} added to the library`;
}));

loadLibrary().catch((e) => showError(e.message));
updateRunHint();
