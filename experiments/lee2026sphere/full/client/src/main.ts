import type {
  EditSubtask, GraphRep, HierarchicalContext, InteractionLog, InteractionState, ObjectFeatureRow, ResolvedInstruction, SceneGraph, Target,
} from '../../shared/types';
import { executeSubtasks } from '../../shared/editOps';
import { VRRuntime } from './vr';
import { SpeechRecorder } from './speech';

// ------------------------------------------------------------------ app state (named after design identifiers)
const state = {
  sessionId: null as string | null,
  request: '',
  scene: null as SceneGraph | null, // scene_1 (edited in place by tool_2 execute)
  interactionLog: null as InteractionLog | null, // interaction_log_1
  targets: [] as Target[], // targets_1
  busy: false,
  finished: false,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : typeof v === 'boolean' ? (v ? '✓' : '') : esc(v ?? ''));

const vr = new VRRuntime($('viewport'));
const speech = new SpeechRecorder();

// ------------------------------------------------------------------ rendering helpers
type StepStatus = 'pending' | 'running' | 'done' | 'error';
function step(container: HTMLElement, actor: string, title: string, rep: string): { set: (s: StepStatus, html?: string, open?: boolean) => void } {
  const el = document.createElement('details');
  el.className = 'step pending';
  el.innerHTML = `<summary><span class="actor ${actor.split(' ')[0].replace(/_\d+$/, '')}">${esc(actor)}</span> <span class="title">${esc(title)}</span> <code class="rep">${esc(rep)}</code><span class="spin"></span></summary><div class="body"></div>`;
  container.appendChild(el);
  return {
    set(s, html, open) {
      el.className = `step ${s}`;
      if (html !== undefined) (el.querySelector('.body') as HTMLElement).innerHTML = html;
      if (open !== undefined) el.open = open;
    },
  };
}

function table(rows: Record<string, unknown>[], cols?: string[], highlight?: (r: Record<string, unknown>) => boolean): string {
  if (!rows.length) return '<p class="muted">empty</p>';
  const cs = cols ?? Object.keys(rows[0]);
  return `<div class="tablewrap"><table><thead><tr>${cs.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr class="${highlight?.(r) ? 'hl' : ''}">${cs.map((c) => `<td>${fmt(r[c])}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function bars(v: number[]): string {
  const max = Math.max(...v.map(Math.abs)) || 1;
  return `<div class="bars">${v.map((x) => `<i style="height:${(Math.abs(x) / max) * 100}%;background:${x >= 0 ? '#4a7bd0' : '#d0754a'}"></i>`).join('')}</div><p class="muted">${v.length}-dimensional, ${v.slice(0, 4).map((x) => x.toFixed(3)).join(', ')}, …</p>`;
}

function probBar(p: number) {
  return `<span class="pbar"><i style="width:${Math.round(p * 100)}%"></i></span>`;
}

function graphList(g: GraphRep, filter?: (e: GraphRep['edges'][number]) => boolean): string {
  const label = new Map(g.nodes.map((n) => [n.id, n.label]));
  const edges = filter ? g.edges.filter(filter) : g.edges;
  return `<ul class="graph">${edges.map((e) => `<li><b>${esc(label.get(e.source) ?? e.source)}</b> <span class="rel">${esc(e.relation)}${e.value !== undefined ? ` ${e.value} m` : ''}</span> <b>${esc(label.get(e.target) ?? e.target)}</b></li>`).join('')}</ul>`;
}

function zoneTree(g: GraphRep): string {
  const zones = g.nodes.filter((n) => n.kind === 'zone');
  return `<ul class="tree"><li><b>${esc(g.nodes[0].label)}</b><ul>${zones
    .map((z) => `<li><span class="zone">${esc(z.label)}</span>: ${g.edges.filter((e) => e.source === z.id).map((e) => esc(e.target)).join(', ')}</li>`)
    .join('')}</ul></li></ul>`;
}

function hierTree(h: HierarchicalContext): string {
  return `<p>${esc(h.room.summary)}</p><ul class="tree">${h.room.zones
    .map((z) => `<li><span class="zone">${esc(z.name)}</span> — ${esc(z.summary)}<ul>${z.objects.map((o) => `<li><code>${esc(o.id)}</code> ${esc(o.role)}</li>`).join('')}</ul></li>`)
    .join('')}</ul>`;
}

async function api<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

async function apiStream(url: string, body: unknown, onStep: (step: string, data: any) => void) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.step === 'error') throw new Error(msg.error);
      onStep(msg.step, msg.data);
    }
  }
}

async function refreshVersions() {
  const s = await fetch('/api/state').then((r) => r.json());
  $('versions').textContent = `memory v${s.memory.version} (${s.memory.scenes.length} scenes) · policy v${s.policy.version}`;
  return s;
}

function setBusy(b: boolean) {
  state.busy = b;
  ($('generate') as HTMLButtonElement).disabled = b;
  ($('mic') as HTMLButtonElement).disabled = b || !state.scene || state.finished;
  ($('finish') as HTMLButtonElement).disabled = b || !state.scene || state.finished;
  ($('typed-form').querySelector('button') as HTMLButtonElement).disabled = b || !state.scene || state.finished;
}

// ------------------------------------------------------------------ process 1
$('request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const request = ($('request') as HTMLTextAreaElement).value.trim();
  if (!request || state.busy) return;
  await generateScene(request);
});

async function generateScene(request: string) {
  setBusy(true);
  const box = $('p1-steps');
  box.innerHTML = '';
  $('p2-steps').innerHTML = '';
  $('p3-steps').innerHTML = '<p class="muted">Runs after you finish editing.</p>';
  const s0 = step(box, 'model_3 translate', 'Embed request', 'request → query_embedding');
  s0.set('running');
  try {
    const r = await api<any>('/api/scenes', { request });
    s0.set('done', `<p class="muted">${esc(r.embeddingModel)}</p>${bars(r.queryEmbedding)}`);
    const memEmpty = r.candidateScenes.length === 0;
    step(box, 'tool_3 match', 'Find similar past scenes', 'preference_memory → candidate_scenes*').set('done',
      memEmpty ? `<p class="muted">Preference memory v${r.memoryVersion} is empty: finish a session to start learning.</p>` : table(r.candidateScenes, ['id', 'request', 'cosine']));
    const chosenScenes = new Set(r.sampledScenes.map((s: any) => s.id));
    step(box, 'model_4 match', 'Rerank scenes (cross-attention)', 'candidate_scenes → scored_scenes').set('done',
      table(r.scoredScenes.map((x: any) => ({ ...x, p: probBar(x.prob) })), ['request', 'cosine', 'score', 'prob']));
    step(box, 'tool_3 select', 'Sample scenes', 'scored_scenes → sampled_scenes*').set('done',
      r.sampledScenes.length ? `<ul>${r.sampledScenes.map((s: any) => `<li>“${esc(s.request)}” <span class="muted">(${s.affordances} preferences)</span></li>`).join('')}</ul>` : '<p class="muted">none</p>');
    step(box, 'model_5 match', 'Rerank spatial preferences', 'sampled_scenes → scored_affordances').set('done',
      table(r.scoredAffordances, ['statement', 'score', 'prob']));
    step(box, 'tool_3 select', 'Sample spatial preferences', 'scored_affordances → sampled_affordances*').set('done',
      r.sampledAffordances.length ? `<ul class="affs">${r.sampledAffordances.map((a: any) => `<li>${esc(a.statement)}</li>`).join('')}</ul>` : '<p class="muted">none</p>', r.sampledAffordances.length > 0);
    step(box, 'tool_1 generate', 'Room constraints', 'request + sampled → room_constraints + retrieval_trace').set('done',
      `<p>${esc(r.roomConstraints.room.roomType.replace(/_/g, ' '))}, ${r.roomConstraints.room.width} × ${r.roomConstraints.room.depth} m</p><p class="muted">objects: ${esc(r.roomConstraints.objectTypes.join(', '))}</p>${r.roomConstraints.notes.length ? `<ul>${r.roomConstraints.notes.map((n: string) => `<li class="muted">${esc(n)}</li>`).join('')}</ul>` : ''}<p class="muted">retrieval trace saved for session ${esc(r.sessionId)} (${chosenScenes.size} scenes, ${r.sampledAffordances.length} preferences)</p>`);
    step(box, 'tool_3 compose', 'Generation constraints', 'room_constraints + sampled_affordances → generation_constraints').set('done',
      table(r.constraintReport.map((c: any) => ({ rule: `${c.kind} ${c.subject}${c.object ? ' → ' + c.object : ''}`, source: c.source, met: c.satisfied === null ? '–' : c.satisfied ? '✓' : '✗' })), ['rule', 'source', 'met'], (row) => row.source === 'retrieved'));
    step(box, 'tool_1 generate', 'Solve layout', 'generation_constraints → scene_graph').set('done',
      `<p>${r.sceneGraph.objects.length} objects, ${r.sceneGraph.relations.length} relations</p>`);
    const s9 = step(box, 'tool_2 translate', 'Show in VR', 'scene_graph → scene');

    state.sessionId = r.sessionId;
    state.request = request;
    state.scene = r.sceneGraph;
    state.interactionLog = { sessionId: r.sessionId, entries: [] }; // interaction_log_1
    state.finished = false;
    $('empty').style.display = 'none';
    vr.clearTargets();
    vr.loadSceneGraph(r.sceneGraph); // tool_2 translate
    s9.set('done', '<p>Scene loaded in the viewport. Use the <b>Enter VR</b> button for a headset.</p>');
    renderLog();
    refreshVersions();
  } catch (err) {
    s0.set('error', `<p class="err">${esc((err as Error).message)}</p>`, true);
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ process 2
vr.onTargetsChanged = (t) => {
  state.targets = t; // targets_1
  $('targets').innerHTML = t.length
    ? t.map((x, i) => `<span class="chip"><b>${i + 1}</b> ${x.kind === 'object' ? esc(x.id) : `floor (${x.x.toFixed(1)}, ${x.z.toFixed(1)})`}</span>`).join('')
    : '<span class="muted">nothing</span>';
};
$('clear-targets').addEventListener('click', () => vr.clearTargets());

async function startSpeaking() {
  if (state.busy || !state.scene || state.finished || speech.recording) return;
  try {
    await speech.start();
    $('mic').classList.add('rec');
    $('mic').textContent = '● Recording… release to send';
  } catch (e) {
    alert(`Microphone unavailable: ${(e as Error).message}. Use the typed command instead.`);
  }
}
async function stopSpeaking() {
  if (!speech.recording) return;
  $('mic').classList.remove('rec');
  $('mic').textContent = '🎙 Hold to speak';
  const pcm = await speech.stop(); // speech_1
  await editRound({ pcm });
}
const mic = $('mic');
mic.addEventListener('pointerdown', startSpeaking);
mic.addEventListener('pointerup', stopSpeaking);
mic.addEventListener('pointerleave', stopSpeaking);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); startSpeaking(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') stopSpeaking(); });
vr.onSqueeze = (pressed) => (pressed ? startSpeaking() : stopSpeaking());

$('typed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('typed') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await editRound({ typed: text });
});

/** tool_2 compose: transcript + pointed targets + scene → interaction_state. */
function composeInteractionState(transcript: string, targets: Target[], scene: SceneGraph): InteractionState {
  return {
    transcript,
    targets,
    scene: {
      room: { roomType: scene.room.roomType, width: scene.room.width, depth: scene.room.depth },
      objects: scene.objects.map((o) => ({ id: o.id, type: o.type, label: o.label, x: o.x, z: o.z, rotation: o.rotation })),
    },
  };
}

/** One round of process 2: speech → transcript → interaction state → resolve → decompose → execute. */
async function editRound(input: { pcm?: Float32Array; typed?: string }) {
  if (!state.scene || !state.interactionLog) return;
  setBusy(true);
  const box = $('p2-steps');
  box.innerHTML = '';
  const targets = [...state.targets];
  let transcript = input.typed ?? '';
  const s1 = step(box, 'model_1 translate', 'Transcribe speech', 'speech → transcript');
  try {
    if (input.pcm) {
      s1.set('running');
      const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(input.pcm.buffer as ArrayBuffer) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      transcript = j.transcript;
      s1.set('done', `<p class="quote">“${esc(transcript)}”</p>`, true);
    } else s1.set('done', `<p class="quote">“${esc(transcript)}”</p><p class="muted">typed instead of spoken</p>`, true);
    if (!transcript) throw new Error('No speech recognised. Try again.');

    const interactionState = composeInteractionState(transcript, targets, state.scene); // tool_2 compose
    step(box, 'tool_2 compose', 'Combine command and pointing', 'transcript + targets → interaction_state').set('done',
      `<p>“${esc(transcript)}” + ${targets.length ? targets.map((t, i) => `${i + 1}: ${t.kind === 'object' ? t.id : `(${t.x}, ${t.z})`}`).join(', ') : 'no pointing'}</p>`);

    const s3 = step(box, 'model_2 translate', 'Resolve references', 'interaction_state → resolved_instruction');
    s3.set('running');
    const { resolvedInstruction } = await api<{ resolvedInstruction: ResolvedInstruction }>('/api/edit/resolve', { interactionState });
    s3.set('done', `<p class="quote">${esc(resolvedInstruction.command)}</p>${resolvedInstruction.references.length ? `<ul>${resolvedInstruction.references.map((r) => `<li>“${esc(r.phrase)}” → <code>${esc(r.resolvedTo)}</code></li>`).join('')}</ul>` : ''}`, true);

    const s4 = step(box, 'model_2 decompose', 'Split into edit operations', 'resolved_instruction → edit_subtasks*');
    s4.set('running');
    const { editSubtasks } = await api<{ editSubtasks: EditSubtask[] }>('/api/edit/decompose', { interactionState, resolvedInstruction });
    s4.set('done', editSubtasks.length ? `<ol>${editSubtasks.map((t) => `<li><code>${esc(JSON.stringify(t))}</code></li>`).join('')}</ol>` : '<p class="muted">No editable operation found.</p>', true);

    const { scene, results } = executeSubtasks(state.scene, editSubtasks); // tool_2 execute
    state.scene = scene;
    vr.loadSceneGraph(scene, false);
    state.interactionLog.entries.push({ t: new Date().toISOString(), transcript, targets, resolved: resolvedInstruction, subtasks: editSubtasks, results });
    step(box, 'tool_2 execute', 'Apply edits', 'edit_subtasks → scene + interaction_log').set('done', `<ul>${results.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`, true);
    vr.clearTargets();
    renderLog();
  } catch (err) {
    step(box, 'error', 'Round failed', '').set('error', `<p class="err">${esc((err as Error).message)}</p><p class="muted">The scene was not changed. Point and speak again.</p>`, true);
  } finally {
    setBusy(false);
  }
}

function renderLog() {
  const log = state.interactionLog?.entries ?? [];
  $('log').innerHTML = log.length
    ? log.map((e) => `<li>“${esc(e.transcript)}”<br><span class="muted">${e.results.map(esc).join(' · ')}</span></li>`).join('')
    : '<li class="muted">No edits yet.</li>';
}

// ------------------------------------------------------------------ process 3
$('finish').addEventListener('click', async () => {
  if (!state.scene || !state.sessionId || state.busy) return;
  state.finished = true;
  setBusy(true);
  vr.clearTargets();
  const box = $('p3-steps');
  box.innerHTML = '';
  const order: [string, string, string, string][] = [
    ['session_payload', 'tool_4 compose', 'Package session', 'scene + interaction_log → session_payload'],
    ['object_features', 'tool_4 extract', 'Object features', 'session_payload → object_features'],
    ['functional_zones', 'tool_4 assign', 'Functional zones', 'object_features → functional_zones'],
    ['geometric_context', 'tool_4 extract', 'Relations & connectivity', 'functional_zones → geometric_context'],
    ['hierarchical_context', 'model_6 expand', 'Room → zones → objects', 'geometric_context → hierarchical_context'],
    ['affordances', 'model_6 extract', 'Infer preferences', 'hierarchical_context → affordances*'],
    ['spatial_constraints', 'tool_4 translate', 'Ground as constraints', 'affordances → spatial_constraints*'],
    ['preference_memory', 'tool_4 compose', 'Update memory', 'spatial_constraints → preference_memory_2'],
    ['topdown_view', 'tool_2 translate', 'Top-down view', 'scene → topdown_view'],
    ['realization_signals', 'model_7 evaluate', 'Were retrieved preferences realized?', 'topdown_view + retrieval_trace → realization_signals*'],
    ['rewards', 'tool_5 evaluate', 'Rewards', 'realization_signals → rewards*'],
    ['retrieval_policy', 'tool_5 train', 'Update rerankers (LoRA)', 'rewards + retrieval_policy_1 → retrieval_policy_2'],
  ];
  const steps = new Map(order.map(([k, a, t, r]) => [k, step(box, a, t, r)]));
  let current = 0;
  const advance = (key: string, html: string, open = false) => {
    steps.get(key)!.set('done', html, open);
    current = order.findIndex(([k]) => k === key) + 1;
    if (order[current]) steps.get(order[current][0])!.set('running');
  };
  steps.get(order[0][0])!.set('running');
  try {
    await apiStream('/api/learn/context', { sessionId: state.sessionId, scene: state.scene, interactionLog: state.interactionLog }, (k, d) => {
      if (k === 'session_payload') advance(k, `<p>${d.objects} objects, ${d.edits} edits, ${d.relations} relations</p>`);
      if (k === 'object_features') advance(k, table(d as (ObjectFeatureRow & Record<string, unknown>)[], ['id', 'w', 'd', 'x', 'z', 'rotation', 'nearestWall', 'wallDist', 'windowDist', 'editedByUser', 'addedByUser'], (r) => !!(r.editedByUser || r.addedByUser)));
      if (k === 'functional_zones') advance(k, zoneTree(d));
      if (k === 'geometric_context') advance(k, graphList(d, (e) => !['against_wall'].includes(e.relation)));
      if (k === 'hierarchical_context') advance(k, hierTree(d), true);
      if (k === 'affordances') advance(k, `<ul class="affs">${(d as string[]).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`, true);
      if (k === 'spatial_constraints') advance(k, table(d.constraints.map((c: any) => ({ kind: c.kind, subject: c.subject, object: c.object ?? '' }))) + (d.rejected.length ? `<p class="muted">Not groundable, not stored: ${d.rejected.map(esc).join(' · ')}</p>` : ''));
      if (k === 'preference_memory') advance(k, `<p>preference memory v${d.version}: ${d.scenes} scenes (+${d.added} preferences)</p>`);
    });
    const { png, legend } = vr.renderTopdown(); // tool_2 translate
    advance('topdown_view', `<img class="topdown" src="${png}" alt="top-down view" />`, true);
    await apiStream('/api/learn/evaluate', { sessionId: state.sessionId, topdownPng: png, legend }, (k, d) => {
      if (k === 'realization_signals') advance(k, d.length ? table(d.map((s: any) => ({ statement: s.statement, signal: s.signal, reason: s.reason }))) : '<p class="muted">No preferences were retrieved for this session.</p>', true);
      if (k === 'rewards') advance(k, d.mean === null ? '<p class="muted">no rewards</p>' : table(d.affordances, ['id', 'reward']) + `<p>scene rewards: ${d.scenes.map((s: any) => `${esc(s.id)} = ${s.reward === null ? '–' : s.reward.toFixed(2)}`).join(', ')}</p><p>mean reward ${d.mean.toFixed(2)}</p>`);
      if (k === 'retrieval_policy') advance(k, `<p>${d.report.updated ? `retrieval policy v${d.version}` : 'policy unchanged'} — ${esc(d.report.note)}</p>${d.report.updated ? `<p class="muted">gradient norm: scene ${d.report.sceneGradNorm}, affordance ${d.report.affordanceGradNorm}; baseline ${d.report.baselineBefore} → ${d.report.baselineAfter}</p>` : ''}${rewardChart(d.history)}`, true);
    });
    const done = document.createElement('p');
    done.className = 'ok';
    done.textContent = 'Learned. Generate a new scene to use the updated memory and policy.';
    box.appendChild(done);
  } catch (err) {
    if (order[current]) steps.get(order[current][0])!.set('error', `<p class="err">${esc((err as Error).message)}</p>`, true);
    state.finished = false;
  } finally {
    setBusy(false);
    refreshVersions();
  }
});

function rewardChart(history: { version: number; meanReward: number }[]): string {
  if (history.length < 1) return '';
  const w = 260, h = 70;
  const pts = history.map((p, i) => `${history.length === 1 ? w / 2 : (i / (history.length - 1)) * (w - 20) + 10},${h - 10 - p.meanReward * (h - 20)}`);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><text x="2" y="10">mean reward per policy update</text><line x1="10" x2="${w - 10}" y1="${h - 10}" y2="${h - 10}" /><polyline points="${pts.join(' ')}" />${pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3"/>`).join('')}</svg>`;
}

// ------------------------------------------------------------------ inspector & reset
$('inspect').addEventListener('click', async () => {
  const s = await refreshVersions();
  $('inspector-body').innerHTML = `<h2>Preference memory v${s.memory.version}</h2>${s.memory.scenes.length ? s.memory.scenes.map((sc: any) => `<div class="memscene"><b>“${esc(sc.request)}”</b> <span class="muted">${esc(sc.roomType)} · ${esc(sc.id)}</span><ul class="affs">${sc.affordances.map((a: any) => `<li>${esc(a.statement)}</li>`).join('')}</ul></div>`).join('') : '<p class="muted">empty</p>'}
  <h2>Retrieval policy v${s.policy.version}</h2>${table([{ temperature: s.policy.temperature, kScenes: s.policy.kScenes, kAffordances: s.policy.kAffordances, lr: s.policy.learningRate, baseline: s.policy.baseline, 'scene LoRA |B|': s.policy.sceneLoraNorm.B, 'affordance LoRA |B|': s.policy.affordanceLoraNorm.B }])}${rewardChart(s.policy.history)}`;
  ($('inspector') as HTMLDialogElement).showModal();
});
$('reset').addEventListener('click', async () => {
  if (!confirm('Delete the learned preference memory and retrieval policy?')) return;
  await api('/api/reset', {});
  refreshVersions();
});

refreshVersions();
setBusy(false);
