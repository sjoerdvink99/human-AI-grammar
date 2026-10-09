// System X front end. One module, no build step. Server state lives in `S`; UI-only state in `ui`.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null; // server state
const ui = {
  tab: location.hash.slice(1) || 'collection',
  hlUnit: null,
  jobs: {},              // key -> job snapshot
  pendingRunId: null,    // run awaiting human skill selection
  chosen: new Set(),     // chosen_skills draft
  focusedCluster: null,  // focused_cluster_1
  feedback: {},          // annotation_feedback draft: unitId -> {verdict, comment, labelId}
  clusterLabel: {},      // human assign draft: clusterId -> labelId
  chatFocus: null,       // chat_focus_1 {type,id}
  libVersion: null, kbVersion: null,
};

// ---------------- api ----------------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || res.statusText);
  return data;
}
async function refresh() { S = await api('/api/state'); render(); }
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = `show${err ? ' err' : ''}`;
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), err ? 6000 : 2500);
}
/** Start a job-returning endpoint and poll it, re-rendering progress under `key`. */
async function runJob(key, path, body) {
  try {
    const { jobId } = await api(path, body);
    for (;;) {
      const job = await api(`/api/jobs/${jobId}`);
      ui.jobs[key] = job;
      render();
      if (job.status !== 'running') {
        await refresh();
        if (job.status === 'error') throw new Error(job.error);
        return job;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch (e) { toast(e.message, true); ui.jobs[key] = { ...(ui.jobs[key] || {}), status: 'error', error: e.message }; render(); return null; }
}
const busy = (key) => ui.jobs[key]?.status === 'running';
function jobView(key) {
  const j = ui.jobs[key];
  if (!j) return '';
  return `<ul class="steps">${j.steps.map((s) => `<li class="${s.status}" title="${esc(s.detail)}">${esc(s.name)}${s.detail ? ` · <span class="muted">${esc(s.detail)}</span>` : ''}</li>`).join('')}</ul>
  ${j.status === 'error' ? `<div class="chip bad">${esc(j.error)}</div>` : ''}`;
}

// ---------------- helpers over state ----------------
const label = (id) => S.labelTaxonomy.nodes.find((n) => n.id === id)?.label || id || '—';
const box = (unitId) => S.boundingBoxes.find((b) => b.unitId === unitId);
const art = (id) => S.artworks.find((a) => a.id === id);
const unitDesc = (unitId) => S.unitDescriptions.find((d) => d.unitId === unitId)?.text || '';
const basic = (unitId) => S.basicLabels.find((l) => l.unitId === unitId)?.label || '';
const activeRun = () => S.runs.find((r) => r.id === S.activeRunId) || S.runs.filter((r) => r.status === 'done').at(-1);
const latestLib = () => S.skillLibrary.versions.at(-1);
const latestKB = () => S.knowledgeBase.versions.at(-1);
const confirmedFor = (unitId) => S.confirmedLabels.find((c) => c.unitId === unitId);

function crop(unitId, size = 96) {
  const b = box(unitId); if (!b) return '';
  const a = art(b.artworkId);
  const k = size / Math.max(b.w, b.h);
  return `<div class="crop" title="${esc(unitId)}: ${esc(unitDesc(unitId))}" style="width:${Math.round(b.w * k)}px;height:${Math.round(b.h * k)}px;background-image:url(${a.image});background-size:${a.width * k}px ${a.height * k}px;background-position:-${b.x * k}px -${b.y * k}px"></div>`;
}
function labelSelect(name, value, extra = '') {
  const nodes = S.labelTaxonomy.nodes;
  const groups = nodes.filter((n) => n.parent === 'root');
  return `<select name="${name}" ${extra}>${groups.map((g) => `<optgroup label="${esc(g.label)}"><option value="${g.id}" ${g.id === value ? 'selected' : ''}>${esc(g.label)} (general)</option>${nodes.filter((n) => n.parent === g.id).map((n) => `<option value="${n.id}" ${n.id === value ? 'selected' : ''}>${esc(n.label)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
const bar = (v, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.round(v * 100)}%"></i></div>`;

// ---------------- render ----------------
function render() {
  if (!S) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  $('#provider').textContent = `models: ${S.provider.provider} / ${S.provider.model}`;
  const views = { collection: viewCollection, task: viewTask, review: viewReview, learning: viewLearning, library: viewLibrary };
  const main = $('#main');
  const scroll = window.scrollY;
  const active = document.activeElement;
  const keep = active && active.id ? { id: active.id, value: active.value, start: active.selectionStart } : null;
  main.innerHTML = views[ui.tab]();
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.start, keep.start); } catch {} } }
  window.scrollTo(0, scroll);
}

// ---- Process 1: collection ----
function viewCollection() {
  const described = S.artworkDescriptions.length;
  return `
  <div class="panel">
    <div class="row">
      <div class="grow"><h2>Collection</h2>
        <div class="muted">${S.artworks.length} artworks · ${S.boundingBoxes.length || S.artworkMetadata.reduce((a, m) => a + m.objects.length, 0)} units · ${described}/${S.artworks.length} described</div></div>
      <button class="btn" data-act="p1" ${busy('p1') ? 'disabled' : ''}>${described ? 'Describe new artworks' : 'Describe collection'}</button>
      <button class="btn secondary" data-act="p1-force" ${busy('p1') ? 'disabled' : ''}>Regenerate all descriptions</button>
    </div>
    ${jobView('p1')}
    <details class="small"><summary>Add an artwork (image + unit boxes)</summary>
      <form id="upload" class="row" style="margin-top:8px;align-items:flex-start">
        <input type="file" name="image" accept="image/*" required />
        <textarea name="metadata" rows="4" style="max-width:520px" placeholder='{"title":"…","artist":"…","year":1500,"medium":"…","objects":[{"label":"person","bbox":[x,y,w,h]}]}'></textarea>
        <button class="btn small">Upload</button>
        <button class="btn small secondary" type="button" data-act="seed">Reload sample collection</button>
      </form>
    </details>
  </div>
  <div class="art-grid">${S.artworks.map(artCard).join('')}</div>`;
}
function artCard(a) {
  const meta = S.artworkMetadata.find((m) => m.artworkId === a.id) || {};
  const boxes = S.boundingBoxes.filter((b) => b.artworkId === a.id);
  const desc = S.artworkDescriptions.find((d) => d.artworkId === a.id)?.text;
  return `<div class="art-card">
    <div class="art-img"><img src="${a.image}" alt="${esc(a.title)}"/>
      ${boxes.map((b) => `<div class="bbox ${ui.hlUnit === b.unitId ? 'hl' : ''}" data-unit="${b.unitId}" style="left:${(b.x / a.width) * 100}%;top:${(b.y / a.height) * 100}%;width:${(b.w / a.width) * 100}%;height:${(b.h / a.height) * 100}%"><span>${esc(basic(b.unitId))}</span></div>`).join('')}
    </div>
    <div class="art-body">
      <b>${esc(meta.title || a.title)}</b> <span class="muted">· ${esc(meta.artist)} · ${esc(meta.year)} · ${esc(meta.medium)}</span>
      ${desc ? `<p style="margin:6px 0">${esc(desc)}</p>` : `<p class="muted">Not described yet.</p>`}
      <ul class="unit-list">${boxes.map((b) => `<li data-unit="${b.unitId}" class="${ui.hlUnit === b.unitId ? 'hl' : ''}"><span class="chip">${esc(basic(b.unitId))}</span> ${esc(unitDesc(b.unitId) || '…')} ${confirmedFor(b.unitId) ? `<span class="chip label">${esc(label(confirmedFor(b.unitId).labelId))}</span>` : ''}</li>`).join('')}</ul>
    </div></div>`;
}

// ---- Process 2 / 7: task & clusters ----
function viewTask() {
  const learned = S.skillLibrary.versions.length > 1 || S.knowledgeBase.versions.length > 1;
  const mode = ui.mode || (learned ? 'p7' : 'p2');
  const pending = S.runs.find((r) => r.id === ui.pendingRunId && r.status === 'awaiting_skills');
  const run = activeRun();
  return `
  <div class="panel">
    <h2>Annotation task</h2>
    <textarea id="task" rows="2" placeholder="e.g. Label every human figure by pose and gesture; other units by their basic iconographic type.">${esc(ui.taskDraft || '')}</textarea>
    <div class="row" style="margin-top:8px">
      <label><input type="radio" name="mode" value="p2" ${mode === 'p2' ? 'checked' : ''}/> Exploratory run <span class="muted small">(process 2: embeddings, refinement, review priorities)</span></label>
      <label><input type="radio" name="mode" value="p7" ${mode === 'p7' ? 'checked' : ''}/> Run with learned skills &amp; knowledge <span class="muted small">(process 7: skill library v${latestLib().version}, knowledge base v${latestKB().version})</span></label>
      <span class="grow"></span>
      <button class="btn" data-act="suggest" ${busy('suggest') || !S.unitDescriptions.length ? 'disabled' : ''}>Suggest skills</button>
    </div>
    ${!S.unitDescriptions.length ? '<p class="chip warn">Describe the collection first (tab 1).</p>' : ''}
    ${jobView('suggest')}
    ${pending ? skillPicker(pending) : ''}
    ${jobView('cluster')}
  </div>
  ${S.runs.length ? `<div class="panel small"><b>Runs</b> ${S.runs.filter((r) => r.status !== 'awaiting_skills').map((r) => `<button class="btn small ${r.id === run?.id ? '' : 'secondary'}" data-act="activate" data-run="${r.id}" title="${esc(r.task)}">P${r.process} · ${esc(r.task.slice(0, 40))}${r.status !== 'done' ? ` (${r.status})` : ''}</button>`).join(' ')}</div>` : ''}
  ${run ? runView(run) : ''}`;
}
function skillPicker(run) {
  const lib = S.skillLibrary.versions.find((v) => v.version === run.skillLibraryVersion);
  const sug = [...run.suggestedSkills].sort((a, b) => b.relevance - a.relevance);
  const other = lib.skills.filter((k) => !sug.some((s) => s.skillId === k.id));
  const item = (k, s) => `<label class="skill ${s ? 'suggested' : ''}"><input type="checkbox" data-skill="${k.id}" ${ui.chosen.has(k.id) ? 'checked' : ''}/>
      <div class="grow"><b>${esc(k.name)}</b> ${k.origin === 'learned' ? '<span class="chip ok">learned</span>' : ''} <span class="muted small">${esc(k.description)}</span>
      ${s ? `<div class="row small" style="margin-top:4px">${bar(s.relevance)}<span>${Math.round(s.relevance * 100)}%</span><span class="muted">${esc(s.reason)}</span></div><div class="small"><i>How it applies:</i> ${esc(s.application)}</div>` : ''}</div></label>`;
  return `<h3>Choose skills <span class="muted small">(suggested by model_2, pre-selected; adjust and run)</span></h3>
    ${sug.map((s) => item(lib.skills.find((k) => k.id === s.skillId), s)).join('')}
    ${other.length ? `<details><summary class="small muted">Other skills in library v${lib.version} (${other.length})</summary>${other.map((k) => item(k, null)).join('')}</details>` : ''}
    <div class="row" style="margin-top:8px"><button class="btn" data-act="start" data-run="${run.id}" ${busy('cluster') || !ui.chosen.size ? 'disabled' : ''}>Run ${run.process === 2 ? 'process 2' : 'process 7'} with ${ui.chosen.size} skill(s)</button></div>`;
}
function runView(run) {
  if (!run.clusters) return `<div class="panel muted">Run ${run.status}…</div>`;
  const lib = S.skillLibrary.versions.find((v) => v.version === run.skillLibraryVersion);
  const order = run.priorityClusters?.length ? [...run.priorityClusters, ...run.clusters.map((c) => c.id).filter((id) => !run.priorityClusters.includes(id))] : run.clusters.map((c) => c.id);
  return `<div class="panel">
    <div class="row"><div class="grow"><h2>Clusters <span class="muted small">clusters_${run.clustersVersion} · process ${run.process}</span></h2>
      <div class="small">Task: <b>${esc(run.task)}</b> · skills: ${run.chosenSkills.map((id) => `<span class="chip">${esc(lib.skills.find((k) => k.id === id)?.name || id)}</span>`).join('')} · library v${run.skillLibraryVersion} · knowledge base v${run.knowledgeBaseVersion}</div></div>
      ${run.status === 'done' ? `<button class="btn" data-act="goto-review">Review clusters →</button>` : ''}</div>
    ${run.embeddings ? `<p class="small muted">Embeddings: ${run.embeddings.n} units × (text ${run.embeddings.textDim} + image ${run.embeddings.imageDim}) → ${run.embeddings.k} similarity groups given to model_3 as hints. Initial assignment: ${run.clustersAssigned?.length} clusters.</p>` : ''}
    ${run.refineChanges?.length ? `<details class="small"><summary>model_3 refinement: ${run.refineChanges.length} change(s)</summary><ul>${run.refineChanges.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    <div class="cluster-grid" style="margin-top:10px">${order.map((id) => clusterCard(run, run.clusters.find((c) => c.id === id))).join('')}</div></div>`;
}
function clusterCard(run, c) {
  const rec = run.recommendedLabels?.find((r) => r.clusterId === c.id);
  const scores = run.labelScores?.find((s) => s.clusterId === c.id)?.scores || [];
  const prio = run.clusterPriorities?.find((p) => p.clusterId === c.id);
  const qpos = run.priorityClusters?.indexOf(c.id);
  return `<div class="cluster">
    <div class="row"><b class="grow">${esc(c.id)} · ${esc(c.name)}</b><span class="muted small">${c.unitIds.length} units</span>
      ${qpos >= 0 ? `<span class="chip bad">review #${qpos + 1}</span>` : ''}${run.reviewed?.includes(c.id) ? '<span class="chip ok">reviewed</span>' : ''}</div>
    <div class="thumbs">${c.unitIds.slice(0, 14).map((u) => crop(u, 54)).join('')}${c.unitIds.length > 14 ? `<span class="muted small">+${c.unitIds.length - 14}</span>` : ''}</div>
    ${rec ? `<div>Recommended: <span class="chip label">${esc(label(rec.labelId))}</span></div>` : ''}
    ${scores.slice(0, 4).map((s) => `<div class="score-row"><span>${esc(label(s.labelId))}</span>${bar(s.score)}<span>${s.score.toFixed(2)}</span></div>`).join('')}
    <p class="small"><i>Pattern:</i> ${esc(run.clusterPatterns?.find((p) => p.clusterId === c.id)?.text || '…')}</p>
    ${run.recommendationRationales ? `<p class="small"><i>Rationale:</i> ${esc(run.recommendationRationales.find((r) => r.clusterId === c.id)?.text)}</p>` : ''}
    ${prio ? `<div class="row small">priority ${bar(prio.priority, 'prio')} ${prio.priority.toFixed(2)} <span class="muted">${esc(prio.reason)}</span></div>` : ''}
  </div>`;
}

// ---- Process 3 + 4: review & chat ----
function viewReview() {
  const run = activeRun();
  if (!run?.clusters || run.status !== 'done') return `<div class="panel muted">No finished run yet. Run a task in tab 2.</div>`;
  const queue = run.priorityClusters?.length ? run.priorityClusters : run.clusters.map((c) => c.id);
  const rest = run.clusters.map((c) => c.id).filter((id) => !queue.includes(id));
  if (!ui.focusedCluster || !run.clusters.some((c) => c.id === ui.focusedCluster)) ui.focusedCluster = queue[0];
  const qItem = (id) => {
    const c = run.clusters.find((x) => x.id === id);
    const p = run.clusterPriorities?.find((x) => x.clusterId === id);
    return `<div class="queue-item ${id === ui.focusedCluster ? 'active' : ''}" data-act="focus" data-cluster="${id}">
      <div class="row"><b class="grow">${esc(c.name)}</b>${run.reviewed?.includes(id) ? '<span class="chip ok">✓</span>' : ''}</div>
      <div class="small muted">${c.unitIds.length} units → ${esc(label(run.recommendedLabels?.find((r) => r.clusterId === id)?.labelId))}</div>
      ${p ? `<div class="row small">${bar(p.priority, 'prio')}${p.priority.toFixed(2)}</div>` : ''}</div>`;
  };
  return `<div class="review">
    <div class="panel"><h4>${run.priorityClusters?.length ? 'Review queue (model_4 priority)' : 'Clusters'}</h4>${queue.map(qItem).join('')}
      ${rest.length ? `<details><summary class="small muted">Other clusters (${rest.length})</summary>${rest.map(qItem).join('')}</details>` : ''}
      <p class="small muted">Confirmed labels: ${S.confirmedLabels.length}/${S.boundingBoxes.length} units · logs: ${S.interactionLogs.length}</p></div>
    <div>${focusView(run)}</div>
    <div class="panel">${chatView(run)}</div>
  </div>`;
}
function focusView(run) {
  const c = run.clusters.find((x) => x.id === ui.focusedCluster);
  const rec = run.recommendedLabels?.find((r) => r.clusterId === c.id)?.labelId;
  const chosenLabel = ui.clusterLabel[c.id] || rec;
  const scores = run.labelScores?.find((s) => s.clusterId === c.id)?.scores || [];
  return `<div class="panel">
    <div class="row"><h2 class="grow">${esc(c.name)} <span class="muted small">${c.id} · ${c.unitIds.length} units</span></h2>
      <button class="btn small secondary" data-act="chat-focus" data-type="cluster" data-id="${c.id}">Ask about this cluster</button></div>
    <p><i>Pattern:</i> ${esc(run.clusterPatterns?.find((p) => p.clusterId === c.id)?.text)}</p>
    <div class="row"><span>Recommended label:</span><span class="chip label">${esc(label(rec))}</span></div>
    <p class="small"><i>Rationale:</i> ${esc(run.recommendationRationales?.find((r) => r.clusterId === c.id)?.text)}</p>
    ${scores.map((s) => `<div class="score-row"><span>${esc(label(s.labelId))}</span>${bar(s.score)}<span>${s.score.toFixed(2)}</span></div>`).join('')}
  </div>
  <div class="panel">
    <h4>Your evaluation per unit <span class="muted">(default: agree)</span></h4>
    <div class="unit-grid">${c.unitIds.map((u) => unitCard(u)).join('')}</div>
    <div class="row" style="margin-top:12px">
      <span>Assign label to agreeing units:</span> ${labelSelect('clusterLabel', chosenLabel, `data-cluster="${c.id}" id="clusterLabel"`)}
      <span class="grow"></span>
      <button class="btn" data-act="confirm" data-cluster="${c.id}">Confirm labels</button>
    </div>
  </div>`;
}
function unitCard(u) {
  const f = ui.feedback[u] || { verdict: 'agree' };
  const conf = confirmedFor(u);
  return `<div class="unit-card ${f.verdict}">
    <div class="row">${crop(u, 72)}<div class="grow small"><b>${esc(u)}</b><br/><span class="muted">${esc(art(box(u).artworkId)?.title)}</span>
      ${conf ? `<br/><span class="chip ok">${esc(label(conf.labelId))}</span>` : ''}</div></div>
    <div class="desc" title="${esc(unitDesc(u))}">${esc(unitDesc(u))}</div>
    <div class="row verdicts">${['agree', 'disagree', 'unsure'].map((v) => `<button class="${v} ${f.verdict === v ? 'on' : ''}" data-act="verdict" data-unit="${u}" data-v="${v}">${{ agree: '✓', disagree: '✗', unsure: '?' }[v]}</button>`).join('')}
      <button class="btn small secondary" data-act="chat-focus" data-type="unit" data-id="${u}" title="Ask the assistant about this unit">ask</button></div>
    ${f.verdict !== 'agree' ? `<input type="text" id="cm-${u}" data-comment="${u}" placeholder="why?" value="${esc(f.comment || '')}" style="width:100%;margin-top:4px"/>` : ''}
    ${f.verdict === 'disagree' ? `<div style="margin-top:4px">${labelSelect('override', f.labelId, `data-override="${u}"`)}</div>` : ''}
  </div>`;
}
function chatView(run) {
  const focus = ui.chatFocus || { type: 'cluster', id: ui.focusedCluster };
  const opts = run.clusters.map((c) => `<option value="cluster:${c.id}" ${focus.type === 'cluster' && focus.id === c.id ? 'selected' : ''}>Cluster ${c.id} · ${esc(c.name)}</option>`).join('')
    + (focus.type === 'unit' ? `<option value="unit:${focus.id}" selected>Unit ${focus.id}</option>` : '');
  const msgs = S.chat.filter((m) => m.runId === run.id);
  return `<h4>Assistant (process 4)</h4>
    <div class="row"><span class="small">Focus</span><select id="chatFocus" class="grow">${opts}</select></div>
    <div class="chat-log">${msgs.map(chatMsg).join('') || '<p class="muted small">Ask about a cluster or unit, e.g. “Is u3 really kneeling?” or “Should haloed figures be split out?”</p>'}</div>
    ${jobView('chat')}
    <textarea id="question" rows="3" placeholder="Your question…" style="margin-top:6px"></textarea>
    <div class="row" style="margin-top:6px"><span class="grow"></span><button class="btn" data-act="ask" ${busy('chat') ? 'disabled' : ''}>Ask</button></div>`;
}
function chatMsg(m) {
  const d = m.decision;
  return `<div class="msg q"><span class="muted small">${m.focus.type} ${esc(m.focus.id)}</span><br/>${esc(m.question)}</div>
    <div class="msg a">${esc(m.answer)}
      ${m.suggestedLabelId ? `<div style="margin-top:6px" class="small">Suggests <span class="chip label">${esc(label(m.suggestedLabelId))}</span> for ${m.unitIds.length} unit(s): ${m.unitIds.map(esc).join(', ')}</div>` : ''}
      ${d ? `<div class="small" style="margin-top:6px">${d.accepted ? `<span class="chip ok">accepted${d.labelId ? ` → ${esc(label(d.labelId))}` : ''}</span>` : '<span class="chip bad">rejected</span>'} ${esc(d.note)}</div>`
        : `<div class="row small" style="margin-top:6px">
          ${m.suggestedLabelId ? labelSelect('chatLabel', m.suggestedLabelId, `data-chatlabel="${m.id}"`) : ''}
          <input type="text" data-chatnote="${m.id}" id="note-${m.id}" placeholder="note (optional)" class="grow"/>
          <button class="btn small" data-act="decide" data-chat="${m.id}" data-acc="1">${m.suggestedLabelId ? 'Accept & apply' : 'Helpful'}</button>
          <button class="btn small secondary" data-act="decide" data-chat="${m.id}" data-acc="0">Reject</button></div>`}
    </div>`;
}

// ---- Process 5 + 6: learning ----
function viewLearning() {
  const from = S.learning.at(-1)?.logCursor ?? 0;
  const newLogs = S.interactionLogs.length - from;
  return `<div class="panel">
    <div class="row"><div class="grow"><h2>Learn from this session</h2>
      <div class="muted">${newLogs} new interaction log record(s) · skill library v${latestLib().version} · knowledge base v${latestKB().version}</div></div>
      <button class="btn" data-act="learn" ${busy('learn') || !newLogs ? 'disabled' : ''}>Learn skills &amp; update knowledge</button></div>
    ${jobView('learn')}
  </div>
  ${[...S.learning].reverse().map(learnRound).join('')}
  <div class="panel"><details><summary><b>Interaction logs</b> (interaction_logs_${S.interactionLogsVersion}, ${S.interactionLogs.length} records)</summary>
    <table><tr><th>time</th><th>type</th><th>details</th></tr>${S.interactionLogs.map((l) => `<tr><td class="small">${esc(l.ts.slice(11, 19))}</td><td>${esc(l.type)}</td><td class="small">${esc(logSummary(l))}</td></tr>`).join('')}</table></details></div>`;
}
function logSummary(l) {
  if (l.type === 'cluster_review') return `${l.clusterName}: recommended ${label(l.recommendedLabelId)} → confirmed ${l.confirmedLabelIds.map(label).join(', ') || 'none'}; ${l.unitsAgreed} agreed, ${l.unitsDisagreed} disagreed${l.comments.length ? `; “${l.comments.map((c) => c.comment).join('”, “')}”` : ''}`;
  if (l.type === 'unit_override') return `${l.unitId}: ${label(l.recommendedLabelId)} → ${label(l.confirmedLabelId)} ${l.comment}`;
  if (l.type === 'chat_decision') return `Q: ${l.question} — ${l.accepted ? 'accepted' : 'rejected'}${l.appliedLabelId ? ` ${label(l.appliedLabelId)} on ${l.unitsAffected.length} unit(s)` : ''} ${l.note}`;
  return JSON.stringify(l);
}
function learnRound(r) {
  const libTo = S.skillLibrary.versions.find((v) => v.version === r.libraryTo);
  const kbTo = S.knowledgeBase.versions.find((v) => v.version === r.kbTo);
  return `<div class="panel">
    <h3>Learning round · ${esc(r.ts.slice(0, 16).replace('T', ' '))} · ${r.logCount} logs ${r.status !== 'done' ? `<span class="chip warn">${r.status}</span>` : ''}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div><h4>Process 5 · skills</h4>
      ${r.minedBehaviors ? `<b class="small">Mined behaviours (model_6)</b><ul class="small">${r.minedBehaviors.map((b) => `<li>${esc(b.behavior)} <span class="muted">(${b.strength.toFixed(2)}) — ${esc(b.evidence)}</span></li>`).join('')}</ul>` : ''}
      ${r.candidateSkills ? `<b class="small">Candidate skills (model_7) vs library (model_8)</b><table><tr><th>candidate</th><th>match</th><th>relation</th></tr>${r.candidateSkills.map((c) => {
        const m = r.matchingSkills?.find((x) => x.candidateId === c.id); const d = r.skillDifferences?.find((x) => x.candidateId === c.id);
        return `<tr><td><b>${esc(c.name)}</b><br/><span class="small muted">${esc(c.procedure)}</span></td><td class="small">${m?.skillId ? `${esc(m.skillId)} (${m.similarity.toFixed(2)})` : '—'}</td><td class="small">${d ? `<span class="chip">${esc(d.relation)}</span> ${esc(d.difference)}` : ''}</td></tr>`; }).join('')}</table>` : ''}
      ${libTo ? `<b class="small">Skill library v${r.libraryFrom} → v${r.libraryTo}</b><ul class="small">${libTo.skills.filter((s) => s.change && s.change !== 'unchanged').map((s) => `<li class="diff-${s.change}"><span class="chip">${s.change}</span> <b>${esc(s.name)}</b>: ${esc(s.description)}</li>`).join('') || '<li>No changes</li>'}</ul>` : ''}
    </div>
    <div><h4>Process 6 · knowledge</h4>
      ${r.taskSummary ? `<b class="small">Task summary (model_9)</b><p class="small">${esc(r.taskSummary)}</p>` : ''}
      ${kbTo ? `<b class="small">Knowledge base v${r.kbFrom} → v${r.kbTo} (model_10)</b><ul class="small">${(r.kbOperations || []).map((o) => `<li class="${o.op === 'add' ? 'diff-added' : 'diff-updated'}"><span class="chip">${o.op}</span> <b>${esc(o.topic)}</b>: ${esc(o.content)} <span class="muted">— ${esc(o.reason)}</span></li>`).join('') || '<li>No changes</li>'}</ul>` : ''}
    </div></div></div>`;
}

// ---- Library: skills, knowledge base, taxonomy, confirmed labels ----
function viewLibrary() {
  const lv = ui.libVersion ?? latestLib().version, kv = ui.kbVersion ?? latestKB().version;
  const lib = S.skillLibrary.versions.find((v) => v.version === lv), kb = S.knowledgeBase.versions.find((v) => v.version === kv);
  const tree = (p) => { const kids = S.labelTaxonomy.nodes.filter((n) => n.parent === p); return kids.length ? `<ul>${kids.map((n) => `<li><b>${esc(n.label)}</b> <span class="muted small">${esc(n.id)} — ${esc(n.definition)} ${S.confirmedLabels.filter((c) => c.labelId === n.id).length ? `<span class="chip ok">${S.confirmedLabels.filter((c) => c.labelId === n.id).length}</span>` : ''}</span>${tree(n.id)}</li>`).join('')}</ul>` : ''; };
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
    <div class="panel"><div class="row"><h2 class="grow">Skill library</h2><select data-act="libv">${S.skillLibrary.versions.map((v) => `<option ${v.version === lv ? 'selected' : ''} value="${v.version}">v${v.version}</option>`).join('')}</select></div>
      ${lib.skills.map((k) => `<div class="skill ${k.change === 'added' ? 'diff-added' : k.change === 'updated' ? 'diff-updated' : ''}"><div><b>${esc(k.name)}</b> <span class="chip">${esc(k.origin)}</span> ${k.change && k.change !== 'unchanged' ? `<span class="chip">${k.change}</span>` : ''}<div class="small">${esc(k.description)}</div><div class="small muted">When: ${esc(k.whenToUse)}</div><div class="small">Procedure: ${esc(k.procedure)}</div></div></div>`).join('')}</div>
    <div>
      <div class="panel"><div class="row"><h2 class="grow">Knowledge base</h2><select data-act="kbv">${S.knowledgeBase.versions.map((v) => `<option ${v.version === kv ? 'selected' : ''} value="${v.version}">v${v.version}</option>`).join('')}</select></div>
        <table>${kb.entries.map((e) => `<tr><td><b>${esc(e.topic)}</b><br/><span class="muted small">${esc(e.id)} · ${esc(e.source)}</span></td><td>${esc(e.content)}</td></tr>`).join('')}</table></div>
      <div class="panel tree"><h2>Label taxonomy</h2>${tree(null)}</div>
      <div class="panel"><h2>Confirmed labels <span class="muted small">confirmed_labels_${S.confirmedLabelsVersion}</span></h2>
        <div class="thumbs">${S.confirmedLabels.map((c) => `<div title="${esc(label(c.labelId))} (${c.source})">${crop(c.unitId, 48)}<div class="small" style="max-width:70px">${esc(label(c.labelId))}</div></div>`).join('') || '<span class="muted">none yet</span>'}</div>
        <div class="row" style="margin-top:8px"><button class="btn small secondary" data-act="reset-session">Reset session (keep collection)</button></div></div>
    </div></div>`;
}

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  const tab = e.target.closest('#tabs button');
  if (tab) { ui.tab = tab.dataset.tab; location.hash = ui.tab; render(); return; }
  const unitEl = e.target.closest('[data-unit]:not([data-act])');
  if (unitEl && ui.tab === 'collection') { ui.hlUnit = ui.hlUnit === unitEl.dataset.unit ? null : unitEl.dataset.unit; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const d = el.dataset;
  switch (d.act) {
    case 'p1': case 'p1-force': runJob('p1', '/api/p1/run', { force: d.act === 'p1-force' }); break;
    case 'seed': if (confirm('Replace the collection and all session data with the sample collection?')) { await api('/api/seed', {}); ui.jobs = {}; await refresh(); } break;
    case 'suggest': {
      const task = $('#task').value.trim(); ui.taskDraft = task;
      const mode = document.querySelector('input[name=mode]:checked').value; ui.mode = mode;
      const before = new Set(S.runs.map((r) => r.id));
      const job = await runJob('suggest', '/api/runs/suggest', { task, mode });
      const run = job && S.runs.find((r) => !before.has(r.id));
      if (run) { ui.pendingRunId = run.id; ui.chosen = new Set(run.suggestedSkills.filter((s) => s.relevance >= 0.5).map((s) => s.skillId)); if (!ui.chosen.size) run.suggestedSkills.forEach((s) => ui.chosen.add(s.skillId)); render(); }
      break;
    }
    case 'start': {
      const runId = d.run; ui.pendingRunId = null; ui.focusedCluster = null; ui.feedback = {}; ui.clusterLabel = {};
      const p = runJob('cluster', `/api/runs/${runId}/start`, { chosenSkills: [...ui.chosen] });
      await api(`/api/runs/${runId}/activate`, {}).catch(() => {});
      await p; break;
    }
    case 'activate': await api(`/api/runs/${d.run}/activate`, {}); ui.focusedCluster = null; await refresh(); break;
    case 'goto-review': ui.tab = 'review'; location.hash = 'review'; render(); break;
    case 'focus': ui.focusedCluster = d.cluster; ui.chatFocus = { type: 'cluster', id: d.cluster }; render(); break;
    case 'verdict': ui.feedback[d.unit] = { ...(ui.feedback[d.unit] || {}), verdict: d.v }; render(); break;
    case 'chat-focus': ui.chatFocus = { type: d.type, id: d.id }; render(); $('#question')?.focus(); break;
    case 'confirm': {
      const run = activeRun(); const c = run.clusters.find((x) => x.id === d.cluster);
      const labelId = $('#clusterLabel').value;
      const feedback = c.unitIds.map((u) => ({ unitId: u, ...(ui.feedback[u] || { verdict: 'agree' }) }));
      const bad = feedback.find((f) => f.verdict === 'disagree' && !f.labelId && !f.comment);
      if (bad && !confirm(`${bad.unitId} is marked as disagree without a replacement label or comment; it will stay unlabelled. Continue?`)) return;
      try {
        const r = await api('/api/review/confirm', { runId: run.id, clusterId: c.id, labelId, feedback });
        toast(`${r.confirmed.length} label(s) confirmed · ${r.logs.length} log record(s)`);
        c.unitIds.forEach((u) => delete ui.feedback[u]);
        const q = run.priorityClusters?.length ? run.priorityClusters : run.clusters.map((x) => x.id);
        const next = q.find((id) => id !== c.id && !(run.reviewed || []).includes(id));
        if (next) { ui.focusedCluster = next; ui.chatFocus = null; }
        await refresh();
      } catch (err) { toast(err.message, true); }
      break;
    }
    case 'ask': {
      const run = activeRun(); const q = $('#question').value.trim();
      if (!q) return toast('Write a question first', true);
      const [type, id] = $('#chatFocus').value.split(':');
      $('#question').value = '';
      await runJob('chat', '/api/chat/ask', { runId: run.id, focus: { type, id }, question: q });
      break;
    }
    case 'decide': {
      const chat = S.chat.find((m) => m.id === d.chat);
      const sel = document.querySelector(`[data-chatlabel="${d.chat}"]`);
      const note = document.querySelector(`[data-chatnote="${d.chat}"]`)?.value || '';
      try {
        await api('/api/chat/decide', { chatId: d.chat, accepted: d.acc === '1', labelId: d.acc === '1' && chat.suggestedLabelId ? sel?.value || chat.suggestedLabelId : null, unitIds: chat.unitIds, note });
        await refresh();
      } catch (err) { toast(err.message, true); }
      break;
    }
    case 'learn': runJob('learn', '/api/learn', {}); break;
    case 'reset-session': if (confirm('Clear runs, labels, logs, chat and learned versions?')) { await api('/api/reset-session', {}); ui.jobs = {}; ui.libVersion = ui.kbVersion = null; await refresh(); } break;
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.skill) { t.checked ? ui.chosen.add(t.dataset.skill) : ui.chosen.delete(t.dataset.skill); render(); }
  else if (t.name === 'mode') { ui.mode = t.value; ui.taskDraft = $('#task').value; }
  else if (t.id === 'clusterLabel') ui.clusterLabel[t.dataset.cluster] = t.value;
  else if (t.dataset.override) ui.feedback[t.dataset.override] = { ...ui.feedback[t.dataset.override], labelId: t.value };
  else if (t.id === 'chatFocus') { const [type, id] = t.value.split(':'); ui.chatFocus = { type, id }; }
  else if (t.dataset.act === 'libv') { ui.libVersion = Number(t.value); render(); }
  else if (t.dataset.act === 'kbv') { ui.kbVersion = Number(t.value); render(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.comment) ui.feedback[t.dataset.comment] = { ...ui.feedback[t.dataset.comment], comment: t.value };
  if (t.id === 'task') ui.taskDraft = t.value;
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'upload') return;
  e.preventDefault();
  const res = await fetch('/api/artworks', { method: 'POST', body: new FormData(e.target) });
  const data = await res.json();
  if (data.error) toast(data.error, true); else { toast('Artwork added — click "Describe new artworks"'); await refresh(); }
});

refresh();
