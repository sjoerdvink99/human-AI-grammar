// System X frontend. Names follow the design's identifiers:
// notebook, rules, prompt (prompt_1 / prompt_2), context, triggered_rules, lint_messages,
// code, rule_proposals, accepted_rules, active_rules.
import { esc, diffWords, highlightPython, markQuotes } from './util.js';

const $ = s => document.querySelector(s);
const clientId = Math.random().toString(36).slice(2);

const state = {
  author: localStorage.getItem('systemx.author') || 'analyst-' + clientId.slice(0, 3),
  notebook: { cells: [] },   // notebook_1
  rules: [],                 // rules_n (shared)
  round: null,               // one prompt-time linting round
  newCellId: null,
  editingRuleId: null,
  pendingNotebook: null,
};
localStorage.setItem('systemx.author', state.author);

// ---------------- API ----------------
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------------- Process 4: active_rules (local to this workspace) ----------------
const disabledKey = () => `systemx.disabledRules.${state.author}`;
const disabledRules = () => new Set(JSON.parse(localStorage.getItem(disabledKey()) || '[]'));
function setRuleActive(id, active) { // human select
  const d = disabledRules();
  active ? d.delete(id) : d.add(id);
  localStorage.setItem(disabledKey(), JSON.stringify([...d]));
  renderRules(); renderCounts();
}
const activeRuleIds = () => { const d = disabledRules(); return state.rules.filter(r => !d.has(r.id)).map(r => r.id); };
const ruleById = id => state.rules.find(r => r.id === id);

// ---------------- Notebook (notebook_1) ----------------
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function renderNotebook() {
  const root = $('#cells');
  root.innerHTML = '';
  let exec = 0;
  for (const cell of state.notebook.cells) {
    const el = document.createElement('div');
    el.className = `cell ${cell.type}${cell.id === state.newCellId ? ' new' : ''}`;
    el.innerHTML = `<div class="prompt-no">${cell.type === 'code' ? `[${++exec}]` : 'md'}</div>
      <div class="editor"><textarea spellcheck="false" rows="1"></textarea></div>
      <button class="del" title="Delete cell">✕</button>`;
    const ta = el.querySelector('textarea');
    ta.value = cell.source;
    ta.addEventListener('input', () => { cell.source = ta.value; autosize(ta); saveNotebook(); });
    ta.addEventListener('blur', () => { if (state.pendingNotebook) applyRemoteNotebook(); });
    el.querySelector('.del').onclick = () => { state.notebook.cells = state.notebook.cells.filter(c => c !== cell); renderNotebook(); saveNotebook(); };
    root.appendChild(el);
    requestAnimationFrame(() => autosize(ta));
  }
}
let saveTimer;
function saveNotebook() {
  $('#nb-status').textContent = 'editing…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await api('PUT', '/api/notebook', { notebook: state.notebook, author: state.author, clientId }); $('#nb-status').textContent = 'saved · shared'; }
    catch (e) { $('#nb-status').textContent = 'save failed: ' + e.message; }
  }, 600);
}
function addCell(type, source = '', afterIndex = state.notebook.cells.length - 1) {
  const cell = { id: 'c' + Date.now().toString(36), type, source };
  state.notebook.cells.splice(afterIndex + 1, 0, cell);
  return cell;
}
function applyRemoteNotebook() {
  state.notebook = state.pendingNotebook; state.pendingNotebook = null; renderNotebook();
}

// ---------------- Process 1: prompt-time linting and code generation ----------------
function setStage(name, status) {
  const li = document.querySelector(`#stages [data-stage="${name}"]`);
  li.className = status || '';
}
function resetStages() { $('#stages').classList.remove('hidden'); for (const li of document.querySelectorAll('#stages li')) li.className = ''; }

async function submitPrompt() { // human specify -> prompt_1
  const prompt = $('#prompt').value.trim();
  if (!prompt) return $('#prompt').focus();
  const round = state.round = { prompt1: prompt, activeRuleIds: activeRuleIds() };
  for (const id of ['#context-card', '#lint-card', '#code-card', '#proposal-card']) $(id).classList.add('hidden');
  $('#submit').disabled = true;
  resetStages();
  try {
    // tool_1 extract: notebook_1 -> context_1
    setStage('extract', 'running');
    round.context = await api('POST', '/api/extract', { notebook: state.notebook });
    setStage('extract', 'done'); renderContext(round.context);

    // model_1 match: context_1 + rules_1 + prompt_1 -> triggered_rules_1
    setStage('match', 'running');
    round.triggered = await api('POST', '/api/match', { prompt, context: round.context, activeRuleIds: round.activeRuleIds });
    if (state.round !== round) return;
    setStage('match', 'done');

    // model_2 modify (lint) and model_3 generate (proposals, process 2) both start after rule checking
    await Promise.allSettled([runLint(round), runProposals(round)]);
  } catch (e) {
    for (const li of document.querySelectorAll('#stages li.running')) li.className = 'failed';
    toast('Error: ' + e.message);
  } finally {
    $('#submit').disabled = false;
  }
}

async function runLint(round) {
  setStage('lint', 'running');
  $('#regen-lint').disabled = true;
  try {
    const res = await api('POST', '/api/lint', { prompt: round.prompt1, context: round.context, triggered: round.triggered, activeRuleIds: round.activeRuleIds });
    if (state.round !== round) return;
    round.prompt2 = res.revisedPrompt;           // prompt_2
    round.lintMessages = res.messages;           // lint_messages_1
    setStage('lint', 'done');
    renderLint(round);
  } catch (e) { setStage('lint', 'failed'); toast('Linting failed: ' + e.message); }
  finally { $('#regen-lint').disabled = false; }
}

function renderContext(ctx) {
  $('#context-card').classList.remove('hidden');
  $('#ctx-summary').textContent = `${ctx.variables.length} variables · ${ctx.dataframes.length} dataframes · ${ctx.imports.length} imports`;
  const codes = xs => xs.length ? xs.map(x => `<code>${esc(x)}</code>`).join('') : '<span class="muted">—</span>';
  $('#context').innerHTML = `<div class="ctx-grid">
    <div>Imports</div><div>${codes(ctx.imports.map(i => i.alias === i.module ? i.module : `${i.module} as ${i.alias}`))}</div>
    <div>Dataframes</div><div>${codes(ctx.dataframes.map(d => d.name + (d.columnsUsed.length ? ` [${d.columnsUsed.join(', ')}]` : '')))}</div>
    <div>Variables</div><div>${codes(ctx.variables.filter(v => !v.kind.startsWith('dataframe')).map(v => `${v.name}: ${v.kind}`))}</div>
    <div>Functions</div><div>${codes(ctx.functions.map(f => `${f.name}(${f.params})`))}</div>
    <div>Files</div><div>${codes(ctx.files)}</div>
    <div>Notes</div><div>${ctx.markdownNotes.map(n => esc(n.text.split('\n')[0])).join('<br>') || '—'}</div>
  </div>`;
}

function renderLint(round) {
  $('#lint-card').classList.remove('hidden');
  $('#triggered').innerHTML = round.triggered.length
    ? round.triggered.map(t => { const r = ruleById(t.ruleId); return r ? `<span class="chip sev-${r.severity}" title="${esc(t.reason)}">${esc(r.title)}</span>` : ''; }).join('')
    : '<span class="muted small">No shared rules apply to this prompt.</span>';
  $('#lint-messages').innerHTML = round.lintMessages.map(m => {
    const r = ruleById(m.ruleId);
    return `<div class="lint sev-${m.severity}">
      <div class="lrule">${esc(m.severity.toUpperCase())} · ${esc(r?.title || m.ruleId)}</div>
      <div class="msg">${esc(m.message)}</div>
      ${m.quote ? `<div class="quote">“${esc(m.quote)}”</div>` : ''}
      <div class="expl">${esc(m.explanation)}</div></div>`;
  }).join('');
  $('#orig-view').innerHTML = markQuotes(round.prompt1, round.lintMessages.map(m => m.quote));
  const changed = round.prompt2 !== round.prompt1;
  $('#diff-view').innerHTML = changed ? diffWords(round.prompt1, round.prompt2) : '<span class="muted">No changes suggested.</span>';
  $('#use-revised').textContent = changed ? 'Accept revision & generate' : 'Generate code';
  $('#use-original').classList.toggle('hidden', !changed);
}

// human select: prompt_1 + prompt_2 -> chosen prompt; then model_4 generate -> code_1
async function generate(chosen) {
  const round = state.round;
  round.chosenPrompt = chosen;
  $('#code-card').classList.remove('hidden');
  $('#sent-prompt').textContent = chosen;
  $('#code').innerHTML = '<span class="tok-com"># generating…</span>';
  $('#code-summary').textContent = '';
  for (const b of ['#regen-code', '#insert-code', '#copy-code', '#use-revised', '#use-original']) $(b).disabled = true;
  try {
    const res = await api('POST', '/api/generate', { prompt: chosen });
    if (state.round !== round) return;
    round.code = res.code;
    $('#code').innerHTML = highlightPython(res.code);
    $('#code-summary').textContent = res.summary ? '· ' + res.summary : '';
  } catch (e) {
    $('#code').innerHTML = `<span class="tok-com"># failed: ${esc(e.message)}</span>`;
  } finally {
    for (const b of ['#regen-code', '#insert-code', '#copy-code', '#use-revised', '#use-original']) $(b).disabled = false;
    $('#insert-code').disabled = !round.code;
  }
}

// ---------------- Process 2: propose and share collaboration rules ----------------
async function runProposals(round) {
  setStage('propose', 'running');
  $('#regen-proposals').disabled = true;
  try {
    const proposals = await api('POST', '/api/propose', { prompt: round.prompt1, context: round.context, triggered: round.triggered, activeRuleIds: round.activeRuleIds });
    if (state.round !== round) return;
    round.proposals = proposals.map((p, i) => ({ ...p, key: Date.now() + '-' + i, accepted: false })); // rule_proposals_1
    setStage('propose', 'done');
    renderProposals(round);
  } catch (e) { setStage('propose', 'failed'); toast('Rule proposals failed: ' + e.message); }
  finally { $('#regen-proposals').disabled = false; }
}

function renderProposals(round) {
  const card = $('#proposal-card');
  card.classList.toggle('hidden', !round.proposals?.length);
  const root = $('#proposals');
  root.innerHTML = '';
  for (const p of round.proposals || []) {
    const el = document.createElement('div');
    el.className = 'proposal' + (p.accepted ? ' accepted' : '');
    el.innerHTML = `<input type="checkbox" title="Accept" ${p.accepted ? 'checked' : ''} />
      <div>
        <input type="text" class="title" value="${esc(p.title)}" />
        <textarea class="desc" rows="3">${esc(p.description)}</textarea>
        <div class="row" style="margin-top:2px">
          <select class="sev">${['info', 'warning', 'error'].map(s => `<option ${s === p.severity ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <span class="rationale">${esc(p.rationale)}</span>
        </div>
      </div>`;
    // human modify: rule_proposals_1 -> rule_proposals_2
    el.querySelector('.title').oninput = e => { p.title = e.target.value; };
    el.querySelector('.desc').oninput = e => { p.description = e.target.value; };
    el.querySelector('.sev').onchange = e => { p.severity = e.target.value; };
    // human select: rule_proposals_2 -> accepted_rules_1
    el.querySelector('input[type=checkbox]').onchange = e => { p.accepted = e.target.checked; el.classList.toggle('accepted', p.accepted); updateShareButton(round); };
    root.appendChild(el);
  }
  updateShareButton(round);
}
function updateShareButton(round) {
  const n = (round.proposals || []).filter(p => p.accepted).length;
  $('#share-proposals').disabled = !n;
  $('#share-proposals').textContent = n ? `Share ${n} accepted rule${n > 1 ? 's' : ''}` : 'Share accepted';
}
async function shareProposals() { // tool_2 compose: accepted_rules_1 + rules_1 -> rules_2
  const round = state.round;
  const accepted = round.proposals.filter(p => p.accepted).map(({ title, description, severity }) => ({ title, description, severity }));
  if (accepted.some(a => !a.title.trim() || !a.description.trim())) return toast('Accepted rules need a title and description.');
  try {
    const { added, rules } = await api('POST', '/api/rules/compose', { accepted, author: state.author });
    state.rules = rules;
    round.proposals = round.proposals.filter(p => !p.accepted);
    renderProposals(round); renderRules(); renderCounts();
    toast(added.length ? `Shared ${added.length} rule${added.length > 1 ? 's' : ''} with your team` : 'Those rules already exist on the board');
  } catch (e) { toast('Sharing failed: ' + e.message); }
}

// ---------------- Process 3: edit shared rules + Process 4 toggles ----------------
function renderCounts() {
  $('#rule-count').textContent = state.rules.length;
  $('#active-count').textContent = `${activeRuleIds().length}/${state.rules.length}`;
}
function renderRules(flashIds = []) {
  const q = $('#rule-search').value.toLowerCase(), sev = $('#rule-sev').value;
  const disabled = disabledRules();
  const order = { error: 0, warning: 1, info: 2 };
  const list = state.rules
    .filter(r => (!sev || r.severity === sev) && (!q || (r.title + ' ' + r.description).toLowerCase().includes(q)))
    .sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));
  const root = $('#rules');
  root.innerHTML = list.length ? '' : '<p class="muted">No rules match.</p>';
  for (const r of list) {
    const el = document.createElement('div');
    const active = !disabled.has(r.id);
    el.className = 'rule' + (active ? '' : ' inactive') + (flashIds.includes(r.id) ? ' flash' : '');
    if (state.editingRuleId === r.id) {
      el.innerHTML = `<input class="title" style="width:100%" value="${esc(r.title)}" />
        <textarea class="desc" rows="3" style="margin-top:4px">${esc(r.description)}</textarea>
        <div class="row"><select class="sev">${['info', 'warning', 'error'].map(s => `<option ${s === r.severity ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <span class="spacer"></span><button class="cancel ghost">Cancel</button><button class="save primary">Save &amp; share</button></div>`;
      el.querySelector('.cancel').onclick = () => { state.editingRuleId = null; renderRules(); };
      el.querySelector('.save').onclick = async () => {
        const patch = { title: el.querySelector('.title').value, description: el.querySelector('.desc').value, severity: el.querySelector('.sev').value };
        try {
          const updated = await api('PUT', `/api/rules/${r.id}`, { patch, author: state.author }); // rules_2 -> rules_3
          state.rules = state.rules.map(x => (x.id === updated.id ? updated : x));
          state.editingRuleId = null;
          renderRules([updated.id]);
        } catch (e) { toast('Save failed: ' + e.message); }
      };
    } else {
      el.innerHTML = `<div class="rule-head">
          <span class="chip sev-${r.severity}">${r.severity}</span>
          <span class="rule-title">${esc(r.title)}</span>
          <button class="edit ghost small">Edit</button>
          <label class="switch" title="${active ? 'Active in my workspace' : 'Inactive in my workspace'}"><input type="checkbox" ${active ? 'checked' : ''} /><span></span></label>
        </div>
        <div class="rule-desc">${esc(r.description)}</div>
        <div class="rule-meta">v${r.version} · ${r.origin === 'proposal' ? 'proposed by' : 'by'} ${esc(r.author)}${r.editedBy ? ` · edited by ${esc(r.editedBy)}` : ''} · ${new Date(r.updatedAt).toLocaleString()}</div>`;
      el.querySelector('.edit').onclick = () => { state.editingRuleId = r.id; renderRules(); };
      el.querySelector('.switch input').onchange = e => setRuleActive(r.id, e.target.checked);
    }
    root.appendChild(el);
  }
}

// ---------------- Sync (tool_2) ----------------
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => { $('#sync').textContent = '● synced'; $('#sync').classList.add('on'); };
  es.onerror = () => { $('#sync').textContent = '● reconnecting'; $('#sync').classList.remove('on'); };
  es.addEventListener('rules', ev => {
    const e = JSON.parse(ev.data);
    state.rules = e.rules;
    if (state.editingRuleId && !ruleById(state.editingRuleId)) state.editingRuleId = null;
    if (state.editingRuleId && e.ids.includes(state.editingRuleId) && e.author !== state.author) toast('A teammate just changed the rule you are editing');
    if (!state.editingRuleId) renderRules(e.ids);
    renderCounts();
    if (e.author !== state.author) toast(`${e.author} ${e.type} ${e.ids.length} shared rule${e.ids.length > 1 ? 's' : ''}`);
    setTimeout(() => document.querySelectorAll('.rule.flash').forEach(x => x.classList.remove('flash')), 1500);
  });
  es.addEventListener('notebook', ev => {
    const e = JSON.parse(ev.data);
    if (e.clientId === clientId) return;
    state.pendingNotebook = e.notebook;
    if (!document.activeElement?.closest?.('.cell')) applyRemoteNotebook();
    $('#nb-status').textContent = `updated by ${e.author}`;
  });
}

// ---------------- Wiring ----------------
function wire() {
  $('#author').value = state.author;
  $('#author').onchange = e => {
    state.author = e.target.value.trim() || state.author;
    localStorage.setItem('systemx.author', state.author);
    renderRules(); renderCounts();
  };
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#tab-assistant').classList.toggle('hidden', t.dataset.tab !== 'assistant');
    $('#tab-board').classList.toggle('hidden', t.dataset.tab !== 'board');
  };
  $('#submit').onclick = submitPrompt;
  $('#prompt').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !$('#submit').disabled) submitPrompt(); };
  $('#use-revised').onclick = () => generate(state.round.prompt2);
  $('#use-original').onclick = () => generate(state.round.prompt1);
  $('#regen-lint').onclick = () => runLint(state.round);
  $('#regen-code').onclick = () => generate(state.round.chosenPrompt);
  $('#copy-code').onclick = () => navigator.clipboard.writeText(state.round.code || '').then(() => toast('Copied'));
  $('#insert-code').onclick = () => {
    const cell = addCell('code', state.round.code);
    state.newCellId = cell.id;
    renderNotebook(); saveNotebook();
    document.querySelector('.cell.new')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { state.newCellId = null; document.querySelector('.cell.new')?.classList.remove('new'); }, 2500);
  };
  $('#regen-proposals').onclick = () => runProposals(state.round);
  $('#share-proposals').onclick = shareProposals;
  $('#add-code').onclick = () => { addCell('code'); renderNotebook(); saveNotebook(); };
  $('#add-md').onclick = () => { addCell('markdown'); renderNotebook(); saveNotebook(); };
  $('#rule-search').oninput = () => renderRules();
  $('#rule-sev').onchange = () => renderRules();
}

async function init() {
  wire();
  [state.notebook, state.rules] = await Promise.all([api('GET', '/api/notebook'), api('GET', '/api/rules')]);
  renderNotebook(); renderRules(); renderCounts();
  connectEvents();
}
init().catch(e => toast('Failed to load: ' + e.message));
