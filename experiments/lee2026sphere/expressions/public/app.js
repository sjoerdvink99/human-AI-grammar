import { drawScene, hitTest, renderTopDown, layout } from './canvas.js';
import { createPushToTalk } from './speech.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (x) => (typeof x === 'number' ? (Math.round(x * 100) / 100).toString() : esc(x));

// ---- application state, named after the design's identifiers ----
const state = {
  session_id: null,
  request: '',
  scene: null,
  retrieval_trace: null,
  interaction_log: null,
  targets: { object_ids: [], point: null },
  speech: null,
  transcript: '',
  preference_memory: null,
  retrieval_policy: null,
  busy: false,
  hover: null,
};

// ---- process step definitions (for the pipeline view) ----
const P1 = [
  ['model_3 translate', 'query_embedding'], ['tool_3 match', 'candidate_scenes*'], ['model_4 match', 'scored_scenes'],
  ['tool_3 select', 'sampled_scenes*'], ['model_5 match', 'scored_affordances'], ['tool_3 select', 'sampled_affordances*'],
  ['tool_1 generate', 'room_constraints + retrieval_trace'], ['tool_3 compose', 'generation_constraints'],
  ['tool_1 generate', 'scene_graph'], ['tool_2 translate', 'scene + interaction_log'],
];
const P2 = [
  ['human select', 'targets'], ['human specify', 'speech'], ['model_1 translate', 'transcript'], ['tool_2 compose', 'interaction_state'],
  ['model_2 translate', 'resolved_instruction', true], ['model_2 decompose', 'edit_subtasks*', true], ['tool_2 execute', 'scene'],
];
const P3 = [
  ['tool_4 compose', 'session_payload'], ['tool_4 extract', 'object_features'], ['tool_4 assign', 'functional_zones'],
  ['tool_4 extract', 'geometric_context'], ['model_6 expand', 'hierarchical_context', true], ['model_6 extract', 'affordances*', true],
  ['tool_4 translate', 'spatial_constraints*'], ['tool_4 compose', 'preference_memory_2'], ['tool_2 translate', 'topdown_view'],
  ['model_7 evaluate', 'realization_signals*'], ['tool_5 evaluate', 'rewards*'], ['tool_5 train', 'retrieval_policy_2'],
];

let stepItems = [];
function startPipeline(title, defs) {
  const ol = $('#steps');
  ol.innerHTML = `<li class="muted" style="border:none">${esc(title)}</li>`;
  stepItems = defs.map(([op, out, gen]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="op">[${op}]${gen ? '<span class="gen">~</span>' : ''}</span> → <span class="muted">${esc(out)}</span>`;
    li.dataset.op = op;
    ol.appendChild(li);
    return li;
  });
  markNextRunning();
}
function markNextRunning() {
  const next = stepItems.find((li) => !li.classList.contains('done'));
  stepItems.forEach((li) => li.classList.remove('running'));
  next?.classList.add('running');
}
function completeStep(op, data) {
  const li = stepItems.find((l) => !l.classList.contains('done') && l.dataset.op === op);
  if (!li) return;
  li.classList.add('done');
  if (data !== undefined) {
    const d = document.createElement('details');
    d.innerHTML = `<summary>output</summary><pre>${esc(JSON.stringify(data, null, 1)).slice(0, 6000)}</pre>`;
    li.appendChild(d);
  }
  markNextRunning();
}
function failPipeline(msg) {
  const li = stepItems.find((l) => l.classList.contains('running'));
  li?.classList.replace('running', 'error');
  li?.insertAdjacentHTML('beforeend', `<div class="bad">${esc(msg)}</div>`);
}

async function streamPost(url, body, onStep) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!res.ok && !res.headers.get('content-type')?.includes('ndjson')) throw new Error((await res.json()).error || res.statusText);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'step') { completeStep(msg.step, msg.data); onStep?.(msg.step, msg.data); }
      else if (msg.type === 'error') throw new Error(msg.message);
      else if (msg.type === 'done') done = msg.data;
    }
  }
  return done;
}

function setBusy(b, text = '') {
  state.busy = b;
  $('#generate').disabled = b;
  $('#apply').disabled = b || !state.scene;
  $('#learn').disabled = b || !state.scene;
  $('#mic').disabled = b;
  $('#gen-status').textContent = text;
}

// ---- canvas ----
const canvas = $('#scene');
function redraw() {
  if (!state.scene) return;
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(ctx, state.scene, { width: r.width, height: r.height, selection: state.targets.object_ids, point: state.targets.point, hover: state.hover });
  $('#room-info').textContent = `${state.scene.room.width} × ${state.scene.room.depth} m · ${state.scene.objects.length} objects`;
}
window.addEventListener('resize', redraw);
function eventToMetres(e) {
  const r = canvas.getBoundingClientRect();
  return layout(state.scene, r.width, r.height).toM(e.clientX - r.left, e.clientY - r.top);
}

// [human select] -> targets_1 (spatial selection on the scene itself)
canvas.addEventListener('click', (e) => {
  if (!state.scene || state.busy) return;
  const [x, y] = eventToMetres(e);
  const hit = hitTest(state.scene, x, y);
  const ids = state.targets.object_ids;
  if (hit && !e.altKey) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) state.targets.object_ids = ids.includes(hit.id) ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
    else state.targets.object_ids = ids.length === 1 && ids[0] === hit.id ? [] : [hit.id];
  } else if (x >= 0 && y >= 0 && x <= state.scene.room.width && y <= state.scene.room.depth) {
    state.targets.point = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  }
  renderTargets(); redraw();
});
canvas.addEventListener('mousemove', (e) => {
  if (!state.scene) return;
  const [x, y] = eventToMetres(e);
  const h = hitTest(state.scene, x, y)?.id || null;
  if (h !== state.hover) { state.hover = h; redraw(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { state.targets = { object_ids: [], point: null }; renderTargets(); redraw(); }
});
function renderTargets() {
  const t = state.targets;
  const parts = t.object_ids.map((id, i) => `<span class="tag">${i + 1}. ${esc(id)}</span>`);
  if (t.point) parts.push(`<span class="tag">📍 (${t.point.x}, ${t.point.y})</span>`);
  $('#targets').innerHTML = parts.length ? parts.join('') + ' <span class="muted">(Esc clears)</span>' : 'click objects (shift-click for more), click the floor for a location';
}

// ---- Process 1 ----
async function generate() {
  const request = $('#request').value.trim();
  if (!request) { $('#request').focus(); return; }
  state.request = request;
  setBusy(true, 'generating…');
  startPipeline('Process 1 · generate', P1);
  try {
    const out = await streamPost('/api/generate', { request }, (step, data) => {
      if (step === 'tool_2 translate') { state.scene = data.scene; $('#empty').hidden = true; redraw(); }
    });
    Object.assign(state, { session_id: out.session_id, scene: out.scene, retrieval_trace: out.retrieval_trace, interaction_log: out.interaction_log });
    state.targets = { object_ids: [], point: null };
    $('#edit-bar').classList.remove('disabled');
    $('#undo').disabled = true;
    $('#learn-out').innerHTML = '';
    renderTargets(); redraw(); renderTrace(); renderLog();
    setBusy(false, '');
  } catch (e) { failPipeline(e.message); setBusy(false, ''); }
}
$('#generate').addEventListener('click', generate);
$('#request').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); });
document.querySelectorAll('.ex').forEach((b) => b.addEventListener('click', () => { $('#request').value = b.textContent; }));

// ---- Process 2 ----
const ptt = createPushToTalk({ onInterim: (t) => { $('#transcript').value = t; } });
if (!ptt.available) $('#speech-status').textContent = 'Speech recognition is not available in this browser — type the command instead (Chrome / Edge / Safari support it).';
const mic = $('#mic');
let recording = false;
async function micDown(e) {
  e.preventDefault();
  if (recording || state.busy || !state.scene) return;
  recording = true; mic.classList.add('recording'); mic.textContent = '● Listening…';
  $('#transcript').value = '';
  await ptt.start();
}
async function micUp() {
  if (!recording) return;
  recording = false; mic.classList.remove('recording'); mic.textContent = '🎙 Hold to speak';
  const { speech, transcript, duration_ms } = await ptt.stop();
  state.speech = speech ? { blob: speech, duration_ms } : null;
  if (speech) { const a = $('#speech-audio'); a.src = URL.createObjectURL(speech); a.hidden = false; }
  if (transcript) {
    $('#transcript').value = transcript;
    $('#speech-status').textContent = `Heard (${(duration_ms / 1000).toFixed(1)} s). Edit the text if needed, then Apply — or it applies automatically.`;
    applyEdit();
  } else {
    $('#speech-status').textContent = ptt.available ? 'Nothing recognised — try again or type the command.' : $('#speech-status').textContent;
  }
}
mic.addEventListener('pointerdown', micDown);
mic.addEventListener('pointerup', micUp);
mic.addEventListener('pointerleave', micUp);

async function applyEdit() {
  const transcript = $('#transcript').value.trim();
  if (!transcript || !state.session_id || state.busy) return;
  state.transcript = transcript;
  setBusy(true);
  startPipeline('Process 2 · point and speak', P2);
  completeStep('human select', state.targets);
  completeStep('human specify', state.speech ? { audio_ms: state.speech.duration_ms } : { typed: true });
  completeStep('model_1 translate', { transcript });
  try {
    const out = await streamPost(`/api/sessions/${state.session_id}/edit`, {
      targets: state.targets, transcript, speech_meta: state.speech ? { duration_ms: state.speech.duration_ms, recognised_by: 'web-speech' } : { typed: true },
    });
    state.scene = out.scene; state.interaction_log = out.interaction_log;
    state.targets = { object_ids: [], point: null }; state.speech = null;
    $('#transcript').value = '';
    $('#undo').disabled = !out.can_undo;
    renderTargets(); redraw(); renderLog(); activateTab('log');
  } catch (e) { failPipeline(e.message); }
  setBusy(false);
}
$('#apply').addEventListener('click', applyEdit);
$('#transcript').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyEdit(); });
$('#undo').addEventListener('click', async () => {
  const res = await fetch(`/api/sessions/${state.session_id}/undo`, { method: 'POST' });
  const out = await res.json();
  if (!res.ok) return;
  state.scene = out.scene; state.interaction_log = out.interaction_log;
  $('#undo').disabled = !out.can_undo;
  redraw(); renderLog();
});

// ---- Process 3 ----
$('#learn').addEventListener('click', async () => {
  if (!state.session_id) return;
  setBusy(true);
  activateTab('learn');
  const out = $('#learn-out');
  out.innerHTML = '';
  startPipeline('Process 3 · learn from session', P3);
  const show = (step, data) => out.insertAdjacentHTML('beforeend', renderLearnStep(step, data));
  try {
    await streamPost(`/api/sessions/${state.session_id}/learn`, {}, show);
    const topdown_view = renderTopDown(state.scene); // [tool_2 translate]
    completeStep('tool_2 translate', { bytes: topdown_view.length });
    show('tool_2 translate', { topdown_view });
    await streamPost(`/api/sessions/${state.session_id}/evaluate`, { topdown_view }, show);
    await loadState();
  } catch (e) { failPipeline(e.message); out.insertAdjacentHTML('beforeend', `<p class="bad">${esc(e.message)}</p>`); }
  setBusy(false);
});

// ---- renderers ----
function table(rows, cols, picked = () => false) {
  return `<table><tr>${cols.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) =>
    `<tr class="${picked(r) ? 'picked' : ''}">${cols.map(([, f]) => `<td>${f(r)}</td>`).join('')}</tr>`).join('')}</table>`;
}
const bar = (v, max = 1) => `<span class="bar ${v < 0 ? 'neg' : ''}" style="width:${Math.min(60, Math.abs(v / max) * 60)}px"></span> ${fmt(v)}`;

function renderTrace() {
  const t = state.retrieval_trace;
  if (!t) return;
  const sampled = new Set(t.sampled_scenes.map((s) => s.id));
  const pickedAff = new Set(t.sampled_affordances.map((a) => a.key + a.source_scene));
  $('#tab-trace').innerHTML = `
    <h4>Request</h4><p>${esc(t.request)}</p>
    <h4>Query embedding <span class="muted">(model_3)</span></h4>
    <div>${t.query_embedding.map((v, i) => [v, i]).filter(([v]) => v > 0.05).sort((a, b) => b[0] - a[0])
      .map(([v, i]) => `<span class="chip">${esc(AXES[i] || i)} ${fmt(v)}</span>`).join('')}</div>
    <h4>Scored scenes <span class="muted">(highlighted = sampled)</span></h4>
    ${table(t.scored_scenes, [['scene', (r) => `${esc(r.name)}${r.source === 'memory' ? ' ★' : ''}`], ['sim', (r) => bar(r.sim)], ['model_4', (r) => bar(r.llm_score)],
      ['pref', (r) => fmt(r.pref)], ['value', (r) => fmt(r.value)], ['total', (r) => `<b>${fmt(r.total)}</b>`]], (r) => sampled.has(r.scene_id))}
    <h4>Scored affordances <span class="muted">(highlighted = selected)</span></h4>
    ${table(t.scored_affordances, [['affordance', (r) => esc(r.text)], ['from', (r) => esc(r.source_scene)], ['model_5', (r) => bar(r.llm_score)], ['value', (r) => fmt(r.value)], ['total', (r) => `<b>${fmt(r.total)}</b>`]],
      (r) => pickedAff.has(r.key + r.source_scene))}
    <h4>Room constraints</h4>
    <p>${esc(t.room_constraints.room_type)} · ${t.room_constraints.width} × ${t.room_constraints.depth} m ·
      ${t.room_constraints.objects.map((o) => esc(o.id)).join(', ')}</p>`;
}

function renderLog() {
  const evs = state.interaction_log?.events || [];
  $('#tab-log').innerHTML = evs.slice().reverse().map((e) => {
    if (e.type === 'generated') return `<div class="event muted">Generated ${e.objects} objects from “${esc(e.request)}”</div>`;
    if (e.type === 'undo') return '<div class="event muted">Undo</div>';
    return `<div class="event">
      <div class="said">“${esc(e.transcript)}” ${e.speech?.duration_ms ? '🎙' : '⌨'}</div>
      <div class="muted">pointing at: ${e.targets.map(esc).join(', ') || '—'}${e.point ? ` · 📍(${e.point.x}, ${e.point.y})` : ''}</div>
      <div>→ <i>${esc(e.resolved_instruction?.explanation)}</i> <span class="muted">[${esc(e.resolved_instruction?.intent)}]</span></div>
      <ul>${e.report.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${esc(r.subtask.op)} — ${esc(r.message)}</li>`).join('')}
        ${(e.rejected || []).map((r) => `<li class="bad">rejected ${esc(r.subtask.op)}: ${esc(r.reason)}</li>`).join('')}</ul>
    </div>`;
  }).join('') || '<p class="muted">Voice edits appear here.</p>';
}

function tree(h) {
  return `<div class="tree"><b>${esc(h.room?.type)}</b> — ${esc(h.room?.purpose)}<ul>${(h.zones || []).map((z) =>
    `<li><b>${esc(z.name)}</b> — ${esc(z.purpose)}<ul>${(z.groups || []).map((g) =>
      `<li>${esc(g.name)}: ${g.objects.map(esc).join(', ')} <span class="muted">— ${esc(g.purpose)}</span>
        <ul>${g.relations.map((r) => `<li class="muted">${esc(r)}</li>`).join('')}</ul></li>`).join('')}</ul></li>`).join('')}</ul></div>`;
}

function renderLearnStep(step, d) {
  switch (step) {
    case 'tool_4 compose':
      if (d.session_payload) return `<h4>Session payload</h4><p class="muted">${esc(d.session_payload.request)} · ${d.session_payload.objects} objects · ${d.session_payload.events} log events</p>`;
      return `<h4>Preference memory → v${d.preference_memory.version}</h4><p class="muted">${d.preference_memory.constraints.length} learned constraints, ${d.preference_memory.user_scenes.length} remembered layouts.</p>`;
    case 'tool_4 extract':
      if (d.object_features) return `<h4>Object features</h4>${table(d.object_features, [['id', (r) => esc(r.id)], ['status', (r) => esc(r.status)], ['x,y', (r) => (r.x != null ? `${fmt(r.x)}, ${fmt(r.y)}` : '—')], ['rot', (r) => fmt(r.rot)], ['wall', (r) => (r.against_wall ? '✓' : '')], ['edits', (r) => fmt(r.edits)]])}`;
      return `<h4>Geometric context</h4><p class="muted">${d.geometric_context.edges.length} relations, e.g. ${d.geometric_context.edges.slice(0, 6).map((e) => `${esc(e.a)} ${e.relations.join('/')} ${esc(e.b)}`).join('; ')}</p>`;
    case 'tool_4 assign':
      return `<h4>Functional zones</h4><p>${d.functional_zones.nodes.map((z) => `<span class="chip"><b>${esc(z.id)}</b>: ${z.objects.map(esc).join(', ')}</span>`).join(' ')}</p>`;
    case 'model_6 expand': return `<h4>Hierarchical context <span class="muted">(model_6)</span></h4>${tree(d.hierarchical_context)}`;
    case 'model_6 extract': return `<h4>Affordances <span class="muted">(model_6)</span></h4><ul>${d.affordances.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
    case 'tool_4 translate':
      return `<h4>Spatial constraints</h4>${table(d.spatial_constraints, [['text', (r) => esc(r.text)], ['constraint', (r) => (r.parsed ? `<code>${esc(r.key)}</code> ${esc(JSON.stringify(r.params || {}))}` : '<span class="bad">not parsed</span>')], ['holds', (r) => (r.parsed ? (r.observed ? '✓' : '✗') : '')]])}`;
    case 'tool_2 translate': return `<h4>Top-down view</h4><img class="topdown" src="${d.topdown_view}" alt="top-down view sent to model_7" />`;
    case 'model_7 evaluate':
      return `<h4>Realization signals <span class="muted">(model_7, vision)</span></h4>${table(d.realization_signals, [['affordance', (r) => esc(affText(r.key))], ['signal', (r) => `<b class="sig-${esc(r.signal)}">${esc(r.signal)}</b>`], ['note', (r) => esc(r.note)]])}`;
    case 'tool_5 evaluate': return `<h4>Rewards</h4>${table(d.rewards, [['kind', (r) => esc(r.kind)], ['target', (r) => esc(r.kind === 'affordance' ? affText(r.target) : r.target)], ['reward', (r) => bar(r.reward)]])}`;
    case 'tool_5 train': return `<h4>Retrieval policy → v${d.retrieval_policy.version}</h4>${policyDiff(state.retrieval_policy, d.retrieval_policy)}`;
    default: return '';
  }
}
const affText = (key) => state.retrieval_trace?.sampled_affordances.find((a) => a.key === key)?.text || key;

function policyDiff(a, b) {
  if (!a) return '';
  const rows = ['w_embed', 'w_llm', 'w_pref', 'w_value', 'temperature'].map((k) => ({ k, a: a[k], b: b[k] }));
  const cls = (r) => (r.b > r.a ? 'diff-up' : r.b < r.a ? 'diff-down' : '');
  return table(rows, [['parameter', (r) => r.k], [`v${a.version}`, (r) => fmt(r.a)], [`v${b.version}`, (r) => `<span class="${cls(r)}">${fmt(r.b)}</span>`]]);
}

function renderMemory() {
  const m = state.preference_memory, p = state.retrieval_policy;
  if (!m || !p) return;
  $('#versions').textContent = `preference_memory v${m.version} · retrieval_policy v${p.version}`;
  const prefs = Object.entries(m.object_prefs).sort((a, b) => b[1] - a[1]);
  const sv = Object.entries(p.scene_values).sort((a, b) => b[1] - a[1]);
  const av = Object.entries(p.affordance_values).sort((a, b) => b[1] - a[1]);
  $('#tab-memory').innerHTML = `
    <h4>Preference memory v${m.version} <span class="muted">· ${m.sessions} sessions</span></h4>
    ${m.constraints.length ? table(m.constraints, [['learned constraint', (r) => esc(r.text)], ['key', (r) => `<code>${esc(r.key)}</code>`], ['weight', (r) => bar(r.weight, 3)], ['n', (r) => r.count]]) : '<p class="muted">Nothing learned yet. Finish a session to fill the memory.</p>'}
    ${prefs.length ? `<h4>Object preferences</h4>${table(prefs, [['category', (r) => esc(r[0])], ['weight', (r) => bar(r[1], 3)]])}` : ''}
    ${m.user_scenes.length ? `<h4>Remembered layouts</h4><ul>${m.user_scenes.map((s) => `<li>${esc(s.name)} <span class="muted">(${s.affordances.length} affordances)</span></li>`).join('')}</ul>` : ''}
    <h4>Retrieval policy v${p.version} <span class="muted">· ${p.episodes} episodes</span></h4>
    ${state.retrieval_policy_history?.length ? policyDiff(state.retrieval_policy_history.at(-1), p) : policyDiff(p, p)}
    ${sv.length ? `<h4>Scene values</h4>${table(sv, [['scene', (r) => esc(r[0])], ['value', (r) => bar(r[1])]])}` : ''}
    ${av.length ? `<h4>Affordance values</h4>${table(av, [['affordance', (r) => `<code>${esc(r[0])}</code>`], ['value', (r) => bar(r[1])]])}` : ''}`;
}

let AXES = [];
async function loadState() {
  const s = await (await fetch('/api/state')).json();
  state.preference_memory = s.preference_memory;
  state.retrieval_policy = s.retrieval_policy;
  state.retrieval_policy_history = s.retrieval_policy_history;
  AXES = s.axes;
  renderMemory();
}

function activateTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));
$('#reset').addEventListener('click', async () => {
  if (!confirm('Delete the learned preference memory and retrieval policy?')) return;
  await fetch('/api/reset', { method: 'POST' });
  loadState();
});

setBusy(false);
loadState();
window.__systemx = state; // for debugging and automated walkthroughs
