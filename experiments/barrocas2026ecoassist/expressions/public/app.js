// Application state, named after the design's representations (without version suffix where a single
// slot suffices; code keeps all three versions because steps compare and merge them).
const state = {
  model_choice: 'sonnet',
  code: { 1: null, 2: null, 3: null },
  baseline_rendering: null,
  optimized_rendering: null,
  energy_before: null,
  energy_after: null,
  savings: null,
  diff: [],
  selected_edits: new Set(),
  optimizer_weights: null,
};

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => ($(id).hidden = !on);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    show('build', b.dataset.tab === 'build');
    show('train', b.dataset.tab === 'train');
  }),
);

// ---------- config ----------
const config = await api('/api/config');
state.optimizer_weights = config.weights;
renderModelChoice(config.modelChoices);
renderWeights();
$('train-pages').textContent = `${config.trainingPages} training pages in data/training/`;

function renderModelChoice(choices) {
  const seg = $('model-choice');
  seg.innerHTML = '';
  for (const c of choices) {
    const b = document.createElement('button');
    b.textContent = c[0].toUpperCase() + c.slice(1);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === state.model_choice));
    b.onclick = () => {
      state.model_choice = c;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
    seg.append(b);
  }
}

// ---------- Process 2: request_1 + model_choice_1 -> [model_1 generate]~ -> code_1 ----------
$('btn-generate').onclick = async () => {
  const request = $('request').value.trim();
  if (!request) return setStatus('generate-status', 'Describe the page first.', true);
  $('btn-generate').disabled = true;
  setStatus('generate-status', `Generating with ${state.model_choice}…`);
  try {
    const { code } = await api('/api/generate', { request, model: state.model_choice });
    resetFrom(1);
    state.code[1] = code;
    $('code1').textContent = code;
    show('code1-box');
    $('code1-box').open = false;
    show('step-optimize');
    setStatus('generate-status', `Generated ${code.split('\n').length} lines. Generate again for a different version.`);
    $('btn-generate').textContent = 'Regenerate';
  } catch (e) {
    setStatus('generate-status', e.message, true);
  } finally {
    $('btn-generate').disabled = false;
  }
};

function setStatus(id, msg, err = false) {
  $(id).textContent = msg;
  $(id).classList.toggle('err', err);
}

function resetFrom(version) {
  if (version <= 1) {
    state.code[2] = state.code[3] = null;
    state.energy_before = state.energy_after = state.savings = null;
    state.diff = [];
    state.selected_edits.clear();
    $('pipeline').innerHTML = '';
    ['compare', 'savings', 'step-review', 'step-preview'].forEach((id) => show(id, false));
  }
}

// ---------- Process 3: code_1 + optimizer_weights_1 -> ... -> diff_1 ----------
const PIPELINE = [
  ['render1', 'tool_1 render original'],
  ['energy1', 'tool_2 measure energy'],
  ['optimize', 'model_2 optimize code'],
  ['render2', 'tool_1 render optimized'],
  ['energy2', 'tool_2 measure energy'],
  ['compare', 'tool_5 savings + diff'],
];

function updateWeightsInfo() {
  const w = state.optimizer_weights;
  $('weights-info').textContent = w
    ? `Optimizer (${config.optimizerModel}) trained on ${w.nPairs} pairs · top strategy: ${w.strategies[0].id}`
    : 'Optimizer not trained yet — open “Train optimizer” first.';
  $('btn-optimize').disabled = !w;
}
updateWeightsInfo();

$('btn-optimize').onclick = async () => {
  resetFrom(1);
  show('step-optimize');
  const steps = Object.fromEntries(
    PIPELINE.map(([id, label]) => {
      const li = document.createElement('li');
      li.textContent = label;
      $('pipeline').append(li);
      return [id, li];
    }),
  );
  const run = async (id, fn) => {
    steps[id].className = 'running';
    try {
      const r = await fn();
      steps[id].className = 'done';
      return r;
    } catch (e) {
      steps[id].className = 'failed';
      steps[id].title = e.message;
      steps[id].textContent += ` — ${e.message}`;
      throw e;
    }
  };
  $('btn-optimize').disabled = true;
  try {
    // tool_1 execute + tool_2 evaluate (one request, two visible steps)
    const before = await run('render1', () => api('/api/render', { code: state.code[1] }));
    await run('energy1', async () => before);
    state.baseline_rendering = before.rendering;
    state.energy_before = before.energy;
    $('render-before').src = before.rendering;
    $('energy-before').textContent = `${before.energy.mW} mW`;
    $('energy-after').textContent = '…';
    $('render-after').removeAttribute('src');
    show('compare');

    // model_2 modify~
    const { code } = await run('optimize', () => api('/api/optimize', { code: state.code[1], energyBefore: state.energy_before }));
    state.code[2] = code;

    const after = await run('render2', () => api('/api/render', { code: state.code[2] }));
    await run('energy2', async () => after);
    state.optimized_rendering = after.rendering;
    state.energy_after = after.energy;
    $('render-after').src = after.rendering;
    $('energy-after').textContent = `${after.energy.mW} mW`;

    // tool_5 evaluate + tool_5 extract
    const cmp = await run('compare', () =>
      api('/api/compare', { code1: state.code[1], code2: state.code[2], energyBefore: state.energy_before, energyAfter: state.energy_after }),
    );
    state.savings = cmp.savings;
    state.diff = cmp.diff;
    state.selected_edits = new Set(cmp.diff.map((d) => d.id));
    renderSavings();
    renderDiff();
    show('step-review');
  } catch {
    /* failure shown on the pipeline step */
  } finally {
    $('btn-optimize').disabled = false;
    $('btn-optimize').textContent = 'Optimize again';
  }
};

function renderSavings() {
  const b = state.energy_before.mW;
  const a = state.energy_after.mW;
  const max = Math.max(a, b);
  const pct = state.savings.relative * 100;
  $('savings').innerHTML = `
    <div class="row"><span class="big ${pct < 0 ? 'neg' : ''}">${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%</span>
      <span class="muted">estimated display power (${Math.abs(state.savings.absoluteMw)} mW ${pct >= 0 ? 'saved' : 'more'})</span></div>
    <div class="bars">
      <span>Before</span><div class="bar" style="width:${(b / max) * 100}%"></div><span>${b} mW</span>
      <span>After</span><div class="bar after" style="width:${(a / max) * 100}%"></div><span>${a} mW</span>
    </div>`;
  show('savings');
}

// ---------- Process 3: diff_1 -> [human select] -> selected_edits_1 ----------
function renderDiff() {
  const box = $('diff');
  box.innerHTML = '';
  if (!state.diff.length) box.innerHTML = '<p class="muted">The optimizer made no changes.</p>';
  for (const d of state.diff) {
    const el = document.createElement('div');
    el.className = 'edit';
    el.innerHTML = `
      <header><label><input type="checkbox"> Edit ${d.id.slice(1)}</label><span class="muted">line ${d.line}</span></header>
      ${d.before ? `<pre class="ctx">${esc(d.before)}</pre>` : ''}
      ${d.removed ? `<pre class="del">${esc(prefix(d.removed, '- '))}</pre>` : ''}
      ${d.added ? `<pre class="add">${esc(prefix(d.added, '+ '))}</pre>` : ''}
      ${d.after ? `<pre class="ctx">${esc(d.after)}</pre>` : ''}`;
    const cb = el.querySelector('input');
    cb.checked = state.selected_edits.has(d.id);
    el.classList.toggle('off', !cb.checked);
    cb.onchange = () => {
      cb.checked ? state.selected_edits.add(d.id) : state.selected_edits.delete(d.id);
      el.classList.toggle('off', !cb.checked);
      updateSelCount();
    };
    box.append(el);
  }
  updateSelCount();
}
const prefix = (t, p) => t.replace(/\n$/, '').split('\n').map((l) => p + l).join('\n');
function updateSelCount() {
  $('sel-count').textContent = `${state.selected_edits.size} of ${state.diff.length} edits selected`;
}
$('sel-all').onclick = () => {
  state.selected_edits = new Set(state.diff.map((d) => d.id));
  renderDiff();
};
$('sel-none').onclick = () => {
  state.selected_edits.clear();
  renderDiff();
};

// ---------- Process 3: [tool_5 modify] -> code_3, then Process 4: [tool_5 translate] -> preview_1 ----------
$('btn-apply').onclick = async () => {
  const { code } = await api('/api/apply', { code1: state.code[1], code2: state.code[2], selectedEdits: [...state.selected_edits] });
  state.code[3] = code;
  $('code3').textContent = code;
  $('preview').srcdoc = code; // tool_5 translate: the browser renders code_3
  $('preview-info').textContent = `${state.selected_edits.size} of ${state.diff.length} edits applied.`;
  show('step-preview');
  $('step-preview').scrollIntoView({ behavior: 'smooth' });
};

$('btn-download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.code[3]], { type: 'text/html' }));
  a.download = 'page.html';
  a.click();
};

// ---------- Process 1: training ----------
function renderWeights() {
  const w = state.optimizer_weights;
  if (!w) return ($('weights').innerHTML = '<p class="muted">Not trained yet.</p>');
  const max = Math.max(...w.strategies.map((s) => Math.abs(s.weight)), 1e-9);
  const desc = Object.fromEntries(config.strategies.map((s) => [s.id, s.description]));
  $('weights').innerHTML = `<p class="muted">Trained ${new Date(w.trainedAt).toLocaleString()} on ${w.nPairs} selected pairs (ridge λ=${w.lambda}).</p>
    <table><tr><th>Strategy</th><th>Weight (expected savings)</th><th></th><th>Pairs</th></tr>
    ${w.strategies.map((s) => `<tr title="${esc(desc[s.id] || '')}"><td>${s.id}</td><td class="num">${(s.weight * 100).toFixed(1)}%</td>
      <td><span class="wbar" style="width:${Math.max(0, (s.weight / max) * 200)}px"></span></td><td class="num">${s.support}</td></tr>`).join('')}</table>`;
}

$('btn-train').onclick = () => {
  $('btn-train').disabled = true;
  const log = $('train-log');
  log.textContent = '';
  show('train-log');
  const es = new EventSource('/api/train');
  es.addEventListener('progress', (e) => {
    log.textContent += JSON.parse(e.data).message + '\n';
    log.scrollTop = log.scrollHeight;
  });
  es.addEventListener('done', (e) => {
    const { weights, pairs } = JSON.parse(e.data);
    state.optimizer_weights = weights;
    renderWeights();
    updateWeightsInfo();
    renderPairs(pairs);
    log.textContent += 'Done.\n';
    es.close();
    $('btn-train').disabled = false;
  });
  es.addEventListener('error', (e) => {
    log.textContent += `Error: ${e.data ? JSON.parse(e.data).error : 'connection lost'}\n`;
    es.close();
    $('btn-train').disabled = false;
  });
};

function renderPairs(pairs) {
  $('pairs').innerHTML = `<tr><th>Page</th><th>Strategies</th><th>Before</th><th>After</th><th>Savings</th><th>Used</th></tr>
    ${pairs.map((p) => `<tr class="${p.selected ? '' : 'rejected'}"><td>${p.pageId}</td><td>${p.strategies.join(', ')}</td>
      <td class="num">${p.before}</td><td class="num">${p.after}</td><td class="num">${(p.savings * 100).toFixed(1)}%</td><td>${p.selected ? '✓' : '—'}</td></tr>`).join('')}`;
  show('pairs-box');
}
