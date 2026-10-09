// System X front end. Names follow the design identifiers (notebook, rules, prompt, context, ...).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const state = {
  notebook: null,        // notebook_1
  rulesState: null,      // {version, rules, active, history} — rules_n and active_rules_1
  run: null,             // one pass of process 1
  proposals: null,       // process 2: {status, items: rule_proposals, error}
  editingRule: null,     // id being edited (process 3) or 'new'
  highlightRule: null,
};

/* ---------------- notebook_1 ---------------- */
const NB_KEY = 'systemx.notebook';
async function loadNotebook(forceSample = false) {
  const saved = !forceSample && localStorage.getItem(NB_KEY);
  state.notebook = saved ? JSON.parse(saved) : await api('GET', '/api/sample-notebook');
  saveNotebook();
  renderNotebook();
}
function saveNotebook() { localStorage.setItem(NB_KEY, JSON.stringify(state.notebook)); }

function renderNotebook() {
  const nb = state.notebook;
  $('#nb-title').value = nb.title || '';
  $('#cells').innerHTML = nb.cells.map((c, i) => `
    <div class="cell ${c.type}" data-id="${c.id}">
      <div class="cell-head">
        <span>[${i + 1}] ${c.type}</span>
        <span>
          <button class="icon-btn" data-act="up" title="Move up">↑</button>
          <button class="icon-btn" data-act="down" title="Move down">↓</button>
          ${c.type === 'code' ? `<button class="icon-btn" data-act="output" title="Toggle output">out</button>` : ''}
          <button class="icon-btn" data-act="delete" title="Delete">✕</button>
        </span>
      </div>
      <textarea data-field="source" rows="${Math.min(12, Math.max(1, (c.source || '').split('\n').length))}" spellcheck="false">${esc(c.source)}</textarea>
      ${c.type === 'code' && (c.output || c.showOutput) ? `<div class="output"><div class="output-label">output</div>
        <textarea data-field="output" wrap="off" rows="${Math.min(8, Math.max(1, (c.output || '').split('\n').length))}" spellcheck="false">${esc(c.output)}</textarea></div>` : ''}
    </div>`).join('');
}

function bindNotebook() {
  $('#nb-title').addEventListener('input', (e) => { state.notebook.title = e.target.value; saveNotebook(); });
  $('#cells').addEventListener('input', (e) => {
    const cellEl = e.target.closest('.cell');
    const cell = state.notebook.cells.find((c) => c.id === cellEl.dataset.id);
    cell[e.target.dataset.field] = e.target.value;
    saveNotebook();
  });
  $('#cells').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const cells = state.notebook.cells;
    const i = cells.findIndex((c) => c.id === e.target.closest('.cell').dataset.id);
    if (act === 'delete') cells.splice(i, 1);
    if (act === 'up' && i > 0) [cells[i - 1], cells[i]] = [cells[i], cells[i - 1]];
    if (act === 'down' && i < cells.length - 1) [cells[i + 1], cells[i]] = [cells[i], cells[i + 1]];
    if (act === 'output') cells[i].showOutput = !cells[i].showOutput;
    saveNotebook(); renderNotebook();
  });
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    state.notebook.cells.push({ id: uid(), type: b.dataset.add, source: '', output: '' });
    saveNotebook(); renderNotebook();
  }));
  $('#reset-notebook').addEventListener('click', () => { if (confirm('Replace the notebook with the sample?')) loadNotebook(true); });
  $('#ipynb-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state.notebook = fromIpynb(JSON.parse(await file.text()), file.name);
      saveNotebook(); renderNotebook();
    } catch (err) { alert(`Could not read notebook: ${err.message}`); }
    e.target.value = '';
  });
}

function fromIpynb(nb, name) {
  const join = (x) => (Array.isArray(x) ? x.join('') : String(x || ''));
  const cells = (nb.cells || []).filter((c) => c.cell_type === 'code' || c.cell_type === 'markdown').map((c) => ({
    id: uid(),
    type: c.cell_type,
    source: join(c.source),
    output: (c.outputs || []).map((o) => join(o.text) || join(o.data?.['text/plain'])).filter(Boolean).join('\n').slice(0, 3000),
  }));
  return { title: name.replace(/\.ipynb$/, ''), cells };
}

/* ---------------- Process 1 ---------------- */
const STEPS = [
  ['extract', 'Extract notebook context'],
  ['match', 'Match rules'],
  ['modify', 'Rewrite prompt'],
  ['select', 'Choose prompt'],
  ['generate', 'Generate code'],
];

function renderSteps() {
  const r = state.run;
  $('#steps').innerHTML = r ? STEPS.map(([k, label]) => `<li class="${r.steps[k] || ''}">${label}</li>`).join('') : '';
}

// human specify -> prompt_1, then tool_1 extract, model_1 match, model_2 modify
async function lintPrompt() {
  const prompt = $('#prompt-input').value.trim();
  if (!prompt) { $('#prompt-input').focus(); return; }
  const run = state.run = { prompt1: prompt, steps: { extract: 'running' }, chosen: 'revised' };
  $('#lint-btn').disabled = true;
  renderRun();
  try {
    const { context } = await api('POST', '/api/extract', { notebook: state.notebook }); // tool_1 extract
    run.context = context; run.steps.extract = 'done'; run.steps.match = 'running'; renderRun();

    const m = await api('POST', '/api/match', { context, prompt }); // model_1 match
    if (state.run !== run) return;
    run.rules = m.rules; run.rulesVersion = m.rules_version; run.triggered = m.triggered;
    run.steps.match = 'done'; run.steps.modify = 'running'; renderRun(); if (!state.editingRule) renderRules();

    const mod = await api('POST', '/api/modify', { context, rules: m.rules, prompt, triggered: m.triggered }); // model_2 modify~
    if (state.run !== run) return;
    run.prompt2 = mod.prompt; run.lint = mod.lint_messages; run.skipped = mod.skipped;
    run.chosen = mod.skipped ? 'original' : 'revised';
    run.steps.modify = 'done'; run.steps.select = 'running';
  } catch (e) {
    const k = Object.keys(run.steps).find((s) => run.steps[s] === 'running');
    if (k) run.steps[k] = 'error';
    run.error = e.message;
  } finally {
    $('#lint-btn').disabled = false;
    renderRun();
  }
}

// model_4 generate~ from the selected prompt only
async function generate() {
  const run = state.run;
  const prompt = run.chosen === 'original' ? run.prompt1 : run.prompt2;
  run.steps.select = 'done'; run.steps.generate = 'running'; run.code = null; run.codeError = null;
  run.usedPrompt = prompt;
  renderRun();
  try {
    const { code } = await api('POST', '/api/generate-code', { prompt });
    if (state.run !== run) return;
    run.code = code; run.steps.generate = 'done';
  } catch (e) { run.codeError = e.message; run.steps.generate = 'error'; }
  renderRun();
}

function renderRun() {
  renderSteps();
  const r = state.run;
  $('#context-view').innerHTML = r?.context ? renderContext(r.context) : '';
  if (!r) { $('#lint-view').innerHTML = ''; $('#code-view').innerHTML = ''; return; }

  let html = '';
  if (r.error) html += `<div class="error-box">${esc(r.error)} <button class="btn small" id="retry-lint">Retry</button></div>`;
  if (r.triggered && r.steps.modify === 'running') html += `<p class="hint"><span class="spinner"></span> ${r.triggered.length} rule(s) triggered — rewriting prompt…</p>`;
  if (r.prompt2 !== undefined) {
    const ruleName = (id) => r.rules.find((x) => x.id === id)?.name || id;
    if (r.skipped) html += `<div class="notice">No active rule was triggered — your prompt passes the lint.</div>`;
    const d = diffWords(r.prompt1, r.prompt2);
    html += `<h3>Choose the prompt to use</h3>
      <div class="prompt-choice">
        <div class="choice ${r.chosen === 'original' ? 'selected' : ''}" data-choose="original">
          <div class="choice-head"><span>Original</span><input type="radio" name="chosen" ${r.chosen === 'original' ? 'checked' : ''}></div>
          <div class="text">${r.skipped ? esc(r.prompt1) : d.left}</div>
        </div>
        ${r.skipped ? '' : `<div class="choice ${r.chosen === 'revised' ? 'selected' : ''}" data-choose="revised">
          <div class="choice-head"><span>Revised</span><input type="radio" name="chosen" ${r.chosen === 'revised' ? 'checked' : ''}></div>
          <div class="text">${d.right}</div>
        </div>`}
      </div>`;
    if (r.lint.length) {
      html += `<h3>Lint messages</h3><ul class="lint-list">${r.lint.map((l) => `
        <li class="lint ${l.severity}" data-rule="${esc(l.rule_id)}">
          <div class="lint-rule"><span class="badge ${l.severity}">${l.severity}</span> ${esc(ruleName(l.rule_id))}</div>
          <div>${esc(l.message)}</div>
          ${l.change ? `<div class="lint-change">→ ${esc(l.change)}</div>` : ''}
        </li>`).join('')}</ul>`;
    }
    html += `<div class="row">
      <button class="btn primary" id="generate-btn" ${r.steps.generate === 'running' ? 'disabled' : ''}>Generate code with ${r.chosen} prompt</button>
      <button class="btn" id="propose-btn" ${state.proposals?.status === 'running' ? 'disabled' : ''}>Suggest rules from this prompt</button>
    </div>`;
  }
  $('#lint-view').innerHTML = html;

  let code = '';
  if (r.steps.generate === 'running') code = `<p class="hint"><span class="spinner"></span> Generating code…</p>`;
  if (r.codeError) code = `<div class="error-box">${esc(r.codeError)}</div>`;
  if (r.code) {
    code = `<h3>Generated code</h3><pre class="code">${highlightPython(r.code)}</pre>
      <div class="row"><button class="btn small" id="copy-code">Copy</button><button class="btn small" id="regen-code">Regenerate</button>
      <span class="hint">from the ${r.usedPrompt === r.prompt1 ? 'original' : 'revised'} prompt</span></div>`;
  }
  $('#code-view').innerHTML = code;
}

function renderContext(c) {
  const chips = (arr) => arr.length ? `<div class="chips">${arr.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '<span class="hint">none</span>';
  return `<details class="context"><summary>Notebook context: ${c.dataframes.length} DataFrame(s), ${c.variables.length} variable(s), ${c.imports.length} import(s)</summary>
    ${c.dataframes.map((d) => `<div><b>${esc(d.name)}</b> ${chips(d.columns)}</div>`).join('')}
    <div>Variables ${chips(c.variables.map((v) => `${v.name}: ${v.kind}`))}</div>
    <div>Imports ${chips(c.imports)}</div>
    ${c.functions.length ? `<div>Functions ${chips(c.functions)}</div>` : ''}
  </details>`;
}

function bindAssistant() {
  $('#lint-btn').addEventListener('click', lintPrompt);
  $('#prompt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) lintPrompt(); });
  $('#assistant-pane').addEventListener('click', (e) => {
    const choice = e.target.closest('[data-choose]');
    if (choice) { state.run.chosen = choice.dataset.choose; renderRun(); return; } // human select
    if (e.target.id === 'generate-btn' || e.target.id === 'regen-code') generate();
    if (e.target.id === 'retry-lint') lintPrompt();
    if (e.target.id === 'propose-btn') proposeRules();
    if (e.target.id === 'copy-code') navigator.clipboard.writeText(state.run.code);
  });
  $('#assistant-pane').addEventListener('mouseover', (e) => {
    const l = e.target.closest('.lint');
    const id = l?.dataset.rule || null;
    if (id === state.highlightRule) return;
    state.highlightRule = id;
    document.querySelectorAll('#tab-rules .rule[data-id]').forEach((el) => el.classList.toggle('hl', el.dataset.id === id));
  });
}

/* ---------------- Process 2 ---------------- */
// model_3 generate~ from prompt_1 + context_1 + triggered_rules_1 + rules_1 of the current run
async function proposeRules() {
  const r = state.run;
  state.proposals = { status: 'running', items: [] };
  showTab('proposals'); renderProposals(); renderRun();
  try {
    const { proposals } = await api('POST', '/api/propose-rules', { prompt: r.prompt1, context: r.context, triggered: r.triggered, rules: r.rules });
    state.proposals = { status: 'done', items: proposals.map((p) => ({ ...p, key: uid(), accepted: true })) };
  } catch (e) { state.proposals = { status: 'error', error: e.message, items: [] }; }
  renderProposals(); renderRun();
}

function renderProposals() {
  const p = state.proposals;
  const el = $('#tab-proposals');
  $('#proposal-count').textContent = p?.items?.length || '';
  if (!p) { el.innerHTML = '<p class="empty">Lint a prompt, then use “Suggest rules from this prompt”.</p>'; return; }
  if (p.status === 'running') { el.innerHTML = '<p class="hint"><span class="spinner"></span> Proposing rules…</p>'; return; }
  if (p.status === 'error') { el.innerHTML = `<div class="error-box">${esc(p.error)}</div><button class="btn small" id="retry-propose">Retry</button>`; return; }
  if (!p.items.length) { el.innerHTML = '<p class="empty">No new rules proposed.</p>'; return; }
  el.innerHTML = `<p class="hint">Edit the proposals, untick the ones you don't want, then add them to your rules.</p>
    ${p.items.map((x) => `<div class="rule proposal rule-form" data-key="${x.key}">
      <div class="rule-head"><input type="checkbox" data-pf="accepted" ${x.accepted ? 'checked' : ''} title="Accept">
        <input type="text" data-pf="name" value="${esc(x.name)}">
        <select data-pf="severity" style="width:auto">${['info', 'warning'].map((s) => `<option ${x.severity === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="rationale">${esc(x.rationale)}</div>
      <label class="field-label">When (condition)</label><textarea data-pf="condition" rows="2">${esc(x.condition)}</textarea>
      <label class="field-label">Rewrite guidance</label><textarea data-pf="guidance" rows="2">${esc(x.guidance)}</textarea>
    </div>`).join('')}
    <div class="row"><button class="btn primary" id="compose-btn">Add accepted rules (${p.items.filter((x) => x.accepted).length})</button>
    <button class="btn" id="discard-proposals">Discard</button></div>`;
}

function bindProposals() {
  const el = $('#tab-proposals');
  const update = (e) => { // human modify (rule_proposals_1 -> _2) and human select (accept)
    const f = e.target.dataset.pf;
    if (!f) return;
    const item = state.proposals.items.find((x) => x.key === e.target.closest('[data-key]').dataset.key);
    item[f] = f === 'accepted' ? e.target.checked : e.target.value;
    if (f === 'accepted') renderProposals();
  };
  el.addEventListener('input', update);
  el.addEventListener('change', update);
  el.addEventListener('click', async (e) => {
    if (e.target.id === 'retry-propose') proposeRules();
    if (e.target.id === 'discard-proposals') { state.proposals = null; renderProposals(); }
    if (e.target.id === 'compose-btn') { // tool_2 compose -> rules_2
      const accepted = state.proposals.items.filter((x) => x.accepted).map(({ name, condition, guidance, severity }) => ({ name, condition, guidance, severity }));
      if (!accepted.length) return;
      try {
        state.rulesState = await api('POST', '/api/compose-rules', { accepted });
        state.proposals = null;
        renderProposals(); renderRules(); renderHistory(); showTab('rules');
      } catch (err) { alert(err.message); }
    }
  });
}

/* ---------------- Processes 3 & 4: rules ---------------- */
function renderRules() {
  const s = state.rulesState;
  if (!s) return;
  const triggered = new Map((state.run?.triggered || []).map((t) => [t.rule_id, t.reason]));
  const ruleForm = (r) => `<div class="rule rule-form" data-id="${r.id || 'new'}">
      <label class="field-label">Name</label><input type="text" data-f="name" value="${esc(r.name)}">
      <label class="field-label">When (condition)</label><textarea data-f="condition" rows="3">${esc(r.condition)}</textarea>
      <label class="field-label">Rewrite guidance</label><textarea data-f="guidance" rows="2">${esc(r.guidance)}</textarea>
      <label class="field-label">Severity</label><select data-f="severity">${['info', 'warning'].map((x) => `<option ${r.severity === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <div class="row"><button class="btn small primary" data-act="save">Save</button><button class="btn small" data-act="cancel">Cancel</button></div>
    </div>`;
  const activeCount = s.active.length;
  $('#tab-rules').innerHTML = `
    <div class="row"><span class="hint">v${s.version} · ${activeCount}/${s.rules.length} active</span>
      <button class="btn small" data-act="add">+ New rule</button>
      <button class="btn small" data-act="all-on">All on</button><button class="btn small" data-act="all-off">All off</button></div>
    ${state.editingRule === 'new' ? ruleForm({ name: '', condition: '', guidance: '', severity: 'info' }) : ''}
    ${s.rules.map((r) => state.editingRule === r.id ? ruleForm(r) : `
      <div class="rule ${s.active.includes(r.id) ? '' : 'inactive'} ${triggered.has(r.id) ? 'triggered' : ''} ${state.highlightRule === r.id ? 'hl' : ''}" data-id="${r.id}">
        <div class="rule-head">
          <input type="checkbox" data-act="toggle" ${s.active.includes(r.id) ? 'checked' : ''} title="Active">
          <span class="name">${esc(r.name)}</span><span class="badge ${r.severity}">${r.severity}</span>
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="delete" title="Delete">✕</button>
        </div>
        <div class="meta"><b>When:</b> ${esc(r.condition)}</div>
        <div class="meta"><b>Then:</b> ${esc(r.guidance)}</div>
        ${triggered.has(r.id) ? `<div class="reason">Triggered: ${esc(triggered.get(r.id))}</div>` : ''}
      </div>`).join('')}`;
}

function bindRules() {
  $('#tab-rules').addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const s = state.rulesState;
    const id = e.target.closest('[data-id]')?.dataset.id;
    try {
      if (act === 'toggle') { // Process 4: human select -> active_rules_1
        const ids = e.target.checked ? [...s.active, id] : s.active.filter((x) => x !== id);
        state.rulesState = await api('PUT', '/api/rules/active', { ids });
      } else if (act === 'all-on' || act === 'all-off') {
        state.rulesState = await api('PUT', '/api/rules/active', { ids: act === 'all-on' ? s.rules.map((r) => r.id) : [] });
      } else if (act === 'add') state.editingRule = 'new';
      else if (act === 'edit') state.editingRule = id;
      else if (act === 'cancel') state.editingRule = null;
      else if (act === 'delete') { // Process 3: human modify
        if (!confirm('Delete this rule? (Earlier versions stay in History.)')) return;
        state.rulesState = await api('PUT', '/api/rules', { rules: s.rules.filter((r) => r.id !== id) });
      } else if (act === 'save') { // Process 3: human modify rules_2 -> rules_3
        const form = e.target.closest('.rule-form');
        const val = (f) => $(`[data-f="${f}"]`, form).value;
        const edited = { name: val('name'), condition: val('condition'), guidance: val('guidance'), severity: val('severity') };
        let rules; let newIds = [];
        if (id === 'new') {
          const n = s.rules.reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, '')) || 0), 0) + 1;
          rules = [...s.rules, { id: `r${n}`, ...edited }]; newIds = [`r${n}`];
        } else rules = s.rules.map((r) => (r.id === id ? { ...r, ...edited } : r));
        state.rulesState = await api('PUT', '/api/rules', { rules, newIds });
        state.editingRule = null;
      }
    } catch (err) { alert(err.message); }
    renderRules(); renderHistory();
  });
}

function renderHistory() {
  const s = state.rulesState;
  $('#tab-history').innerHTML = `<p class="hint">Every change to the rule set is kept as a version.</p>` +
    [...s.history].reverse().map((h) => `<div class="history-item"><span><b>v${h.version}</b> · ${esc(h.source)} · ${h.count} rules<br><span class="hint">${new Date(h.at).toLocaleString()}</span></span>
      ${h.version === s.version ? '<span class="hint">current</span>' : `<button class="btn small" data-revert="${h.version}">Restore</button>`}</div>`).join('');
}
function bindHistory() {
  $('#tab-history').addEventListener('click', async (e) => {
    const v = e.target.dataset.revert;
    if (!v) return;
    state.rulesState = await api('POST', '/api/rules/revert', { version: Number(v) });
    renderRules(); renderHistory();
  });
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== `tab-${name}`));
}

/* ---------------- helpers ---------------- */
export function diffWords(a, b) {
  const A = a.split(/(\s+)/); const B = b.split(/(\s+)/);
  const n = A.length; const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0; let j = 0; let left = ''; let right = '';
  while (i < n && j < m) {
    if (A[i] === B[j]) { left += esc(A[i]); right += esc(B[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) left += `<del>${esc(A[i++])}</del>`;
    else right += `<ins>${esc(B[j++])}</ins>`;
  }
  while (i < n) left += `<del>${esc(A[i++])}</del>`;
  while (j < m) right += `<ins>${esc(B[j++])}</ins>`;
  return { left, right };
}

function highlightPython(code) {
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|[rbf]?"(?:\\.|[^"\\\n])*"|[rbf]?'(?:\\.|[^'\\\n])*')|\b(def|class|return|import|from|as|if|elif|else|for|while|in|not|and|or|is|None|True|False|with|lambda|try|except|finally|raise|yield|pass|break|continue|global)\b|\b(\d+\.?\d*)\b|([A-Za-z_]\w*)(?=\()/g;
  let out = ''; let last = 0; let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'kw' : m[4] ? 'num' : 'fn';
    out += `<span class="tok-${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

/* ---------------- init ---------------- */
async function init() {
  bindNotebook(); bindAssistant(); bindProposals(); bindRules(); bindHistory();
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  await loadNotebook();
  state.rulesState = await api('GET', '/api/rules');
  renderRules(); renderHistory(); renderProposals();
}
init();
