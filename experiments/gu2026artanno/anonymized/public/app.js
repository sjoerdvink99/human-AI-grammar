// System X client. Names follow the design identifiers (see README "Design mapping").
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;           // server state
let lastJson = '';
const ui = {
  currentItem: null,    // r22 / r26: the selected image
  filter: 'all',
  showBoxes: true,
  instructionDraft: null,
  selectionMode: 'p2',  // whether the guideline checklist (r12) feeds P2 or P7
  checked: null,        // r12 draft
  review: {},           // per image {verdict, comment, label}  (r23, r24 drafts)
  question: '',         // r27 draft
  judge: { helpful: null, comment: '', label: null }, // r29 + r24_2 drafts
  error: '',
};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { ui.error = data.error || res.statusText; render(); throw new Error(ui.error); }
  ui.error = '';
  return data;
}

async function refresh(force = false) {
  const st = await api('/api/state');
  const json = JSON.stringify(st);
  if (!force && json === lastJson) return;
  lastJson = json;
  S = st;
  render();
}
setInterval(() => { if (S?.job?.running) refresh(); }, 1500);

const act = async (path, body) => { try { await api(path, body); } catch { return; } await refresh(true); };

// ---------- helpers over state ----------
const find = (arr, id) => arr?.find((x) => x.imageId === id);
const taskLabel = (id) => find(S.taskLabels.current, id)?.label;
const prevTaskLabel = (id) => {
  const v = S.taskLabels.versions;
  if (v.length < 2) return null;
  return v[v.length - 2].value.find((x) => x.imageId === id)?.label;
};
const conceptName = (cid) => S.taxonomy.nodes.find((n) => n.id === cid)?.name || cid;
const busy = () => !!S?.job?.running;

function boxesSvg(img) {
  if (!ui.showBoxes) return '';
  const regs = S.regions.filter((r) => r.imageId === img.id);
  return `<svg viewBox="0 0 ${img.width} ${img.height}" preserveAspectRatio="none">${regs.map((r) => {
    const lab = S.objectLabels.find((l) => l.regionId === r.id)?.label || '';
    const [x, y, w, h] = r.bbox;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ffde00" stroke-width="2"/><text x="${x + 2}" y="${Math.max(12, y - 3)}" font-size="13" fill="#ffde00" stroke="#000" stroke-width=".6" font-weight="700">${esc(lab)}</text>`;
  }).join('')}</svg>`;
}

function meter(name, v, color) {
  if (v === undefined || v === null) return '';
  return `<div class="meter"><span>${name}</span><div class="bar"><div style="width:${Math.round(v * 100)}%;background:${color}"></div></div><span>${v.toFixed(2)}</span></div>`;
}

// ---------- left: task panel ----------
function renderTask() {
  const hasData = S.images.length > 0;
  const prepared = S.captions.length > 0;
  const instr = ui.instructionDraft ?? S.instruction.current;
  const libPrev = S.guidelines.versions.length > 1 ? S.guidelines.versions[S.guidelines.versions.length - 2].value : null;
  const suggested = S.suggestedGuidelines;
  const checked = ui.checked ?? S.activeGuidelines;

  return `
  <h2>1 · Dataset <span class="tag">r1 images · r2 annotations</span></h2>
  <div class="row"><button data-act="demo" ${busy() ? 'disabled' : ''}>Load demo dataset</button></div>
  <details><summary>Upload your own images</summary>
    <form id="upload" class="card">
      <div class="muted">Images (png/jpg)</div><input type="file" name="images" multiple accept="image/*">
      <div class="muted" style="margin-top:6px">Annotations JSON (optional): <code>[{"file":"a.jpg","objects":[{"label":"car","bbox":[x,y,w,h]}]}]</code></div>
      <input type="file" name="annotations" accept=".json">
      <div class="row"><button type="submit" ${busy() ? 'disabled' : ''}>Upload (replaces dataset)</button></div>
    </form>
  </details>
  <div class="row"><button class="primary" data-act="p1" ${!hasData || busy() ? 'disabled' : ''}>Prepare dataset (extract regions, describe images)</button></div>
  <div class="muted">${S.images.length} images · ${S.regions.length} regions · ${S.captions.length} captions</div>

  <h2>2 · Labeling task <span class="tag">r7 instruction v${S.instruction.versions.length}</span></h2>
  <textarea id="instruction" rows="3">${esc(instr)}</textarea>
  ${S.instruction.versions.length > 1 ? `<details><summary>Earlier instructions</summary>${S.instruction.versions.slice(0, -1).reverse().map((v) => `<div class="card"><div class="muted">v${v.v}</div>${esc(v.value)} <button data-revert="instruction" data-v="${v.v}">Restore</button></div>`).join('')}</details>` : ''}
  <div class="row">
    ${S.lastRun ? '' : `<button data-act="p2suggest" ${!prepared || busy() ? 'disabled' : ''}>Suggest guidelines</button>`}
    ${S.lastRun ? `<button data-act="p7suggest" ${!prepared || busy() ? 'disabled' : ''} title="Process 7: re-run with the edited instruction, updated guidelines and profile">Re-run with edited instruction</button>
    <button data-act="p2suggest" ${!prepared || busy() ? 'disabled' : ''} title="Process 2: the full labeling run">Full run</button>` : ''}
  </div>
  ${suggested.length ? `
  <div class="card">
    <div class="muted">Suggested guidelines (model) — choose which to apply:</div>
    ${suggested.map((g) => {
      const gl = S.guidelines.current.find((x) => x.id === g.guidelineId);
      return `<label class="cb"><input type="checkbox" data-guide="${g.guidelineId}" ${checked.includes(g.guidelineId) ? 'checked' : ''}>
        <span><b>${esc(gl?.name || g.guidelineId)}</b> <span class="chip ${esc(gl?.label)}">${esc(gl?.label)}</span><br><span class="muted">${esc(g.reason)}</span></span></label>`;
    }).join('')}
    <details><summary>Other guidelines in the library</summary>
      ${S.guidelines.current.filter((g) => !suggested.some((x) => x.guidelineId === g.id)).map((g) => `<label class="cb"><input type="checkbox" data-guide="${g.id}" ${checked.includes(g.id) ? 'checked' : ''}><span>${esc(g.name)} <span class="chip ${esc(g.label)}">${esc(g.label)}</span></span></label>`).join('') || '<span class="muted">none</span>'}
    </details>
    <div class="row"><button class="primary" data-act="${ui.selectionMode === 'p7' ? 'p7run' : 'p2run'}" ${busy() ? 'disabled' : ''}>${ui.selectionMode === 'p7' ? 'Re-run labeling' : 'Run labeling'} with ${checked.length} guideline(s)</button></div>
  </div>` : ''}

  <h2>Guideline library <span class="tag">r8 v${S.guidelines.versions.length}</span></h2>
  ${S.guidelines.current.map((g) => {
    const old = libPrev?.find((x) => x.id === g.id);
    const mark = libPrev ? (!old ? '<span class="chip new">new</span>' : (old.rule !== g.rule || old.label !== g.label) ? '<span class="chip changed">changed</span>' : '') : '';
    return `<div class="guide"><b>${esc(g.id)} · ${esc(g.name)}</b> <span class="chip ${esc(g.label)}">${esc(g.label)}</span> ${mark}<br><span class="muted">${esc(g.rule)}</span>${old && old.rule !== g.rule ? `<br><span class="muted"><s>${esc(old.rule)}</s></span>` : ''}</div>`;
  }).join('')}
  ${S.guidelines.versions.length > 1 ? `<details><summary>Versions</summary>${S.guidelines.versions.map((v) => `<div class="row"><span class="muted">v${v.v} · ${v.value.length} guidelines ${v.step ? '· ' + esc(v.step) : ''}</span> <button data-revert="guidelines" data-v="${v.v}">Restore</button></div>`).join('')}</details>` : ''}

  <h2>User profile <span class="tag">r9 v${S.profile.versions.length}</span></h2>
  <div class="card">
    <ul style="margin:0;padding-left:18px">${S.profile.current.preferences.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <div class="muted" style="margin-top:4px">${esc(S.profile.current.summary)}</div>
  </div>
  ${S.profile.versions.length > 1 ? `<details><summary>Versions</summary>${S.profile.versions.map((v) => `<div class="card"><div class="muted">v${v.v}</div>${v.value.preferences.map(esc).join('<br>')} <button data-revert="profile" data-v="${v.v}">Restore</button></div>`).join('')}</details>` : ''}

  <h2>Concept taxonomy <span class="tag">r10</span></h2>
  <div class="tree">${treeHtml(null)}</div>

  <h2>5 · Learn from labels <span class="tag">${S.labeledExamples.length} labeled examples (r25)</span></h2>
  <div class="row">
    <button data-act="p5" ${!S.labeledExamples.length || busy() ? 'disabled' : ''}>Learn guidelines</button>
    <button data-act="p6" ${!S.labeledExamples.length || busy() ? 'disabled' : ''}>Update profile</button>
  </div>
  ${S.candidateRules.length ? `<details open><summary>Last guideline learning</summary>
    ${S.patterns.map((p) => `<div class="muted"><span class="chip ${esc(p.label)}">${esc(p.label)}</span> ${p.features.map(esc).join('; ')}</div>`).join('')}
    ${S.candidateRules.map((c) => {
      const m = S.ruleMatches.find((x) => x.candidateId === c.id);
      const a = S.ruleAssessments.find((x) => x.candidateId === c.id);
      return `<div class="guide"><b>${esc(c.name)}</b> <span class="chip ${esc(c.label)}">${esc(c.label)}</span> <span class="chip">${esc(a?.action || '?')}</span>${m?.guidelineId ? ` <span class="muted">↔ ${esc(m.guidelineId)}</span>` : ''}<br><span class="muted">${esc(c.rule)}</span><br><span class="muted"><i>${esc(a?.reason)}</i></span></div>`;
    }).join('')}
  </details>` : ''}
  ${S.preferenceSummary ? `<details><summary>Last preference summary</summary><div class="card">${esc(S.preferenceSummary)}</div></details>` : ''}
  `;
}

function treeHtml(parent) {
  const kids = S.taxonomy.nodes.filter((n) => (n.parent || null) === parent);
  if (!kids.length) return '';
  return `<ul>${kids.map((n) => {
    const count = S.conceptLabels.filter((c) => c.conceptId === n.id).length;
    return `<li>${esc(n.name)} ${count ? `<span class="chip">${count}</span>` : ''}${treeHtml(n.id)}</li>`;
  }).join('')}</ul>`;
}

// ---------- center: gallery ----------
function renderGallery() {
  if (!S.images.length) return '<div class="empty">Load the demo dataset or upload images to begin.</div>';
  const inQueue = (id) => find(S.reviewQueue, id)?.priority === 'review';
  let imgs = S.images;
  if (ui.filter === 'review') imgs = imgs.filter((i) => inQueue(i.id) && !find(S.finalLabels, i.id));
  if (ui.filter === 'labeled') imgs = imgs.filter((i) => find(S.finalLabels, i.id));
  if (ui.filter === 'review' || ui.filter === 'all') {
    imgs = [...imgs].sort((a, b) => (find(S.noteScores, b.id)?.score ?? 0) - (find(S.noteScores, a.id)?.score ?? 0));
  }
  const queueCount = S.images.filter((i) => inQueue(i.id) && !find(S.finalLabels, i.id)).length;
  return `
  <div class="gfilters">
    ${['all', 'review', 'labeled'].map((f) => `<button data-filter="${f}" class="${ui.filter === f ? 'on' : ''}">${f === 'review' ? `Review queue (${queueCount})` : f === 'labeled' ? `Labeled (${S.finalLabels.length})` : `All (${S.images.length})`}</button>`).join('')}
    <label class="muted"><input type="checkbox" id="boxes" ${ui.showBoxes ? 'checked' : ''}> regions</label>
    ${S.lastRun ? `<span class="muted">labels from ${S.lastRun === 'p7' ? 're-run (process 7)' : 'full run (process 2)'}</span>` : ''}
  </div>
  <div class="grid">${imgs.map((img) => {
    const tl = taskLabel(img.id);
    const prev = prevTaskLabel(img.id);
    const fl = find(S.finalLabels, img.id)?.label;
    const q = find(S.reviewQueue, img.id)?.priority;
    const c = find(S.conceptLabels, img.id)?.conceptId;
    return `<div class="item ${ui.currentItem === img.id ? 'sel' : ''}" data-item="${img.id}">
      <div class="imgwrap"><img src="/images/${esc(img.file)}" alt="${esc(img.id)}">${boxesSvg(img)}</div>
      <div class="row" style="margin:4px 0 2px">
        <b style="font-size:12px">${esc(img.id)}</b>
        ${tl ? `<span class="chip ${esc(tl)}" title="model label (r15)">${esc(tl)}</span>` : ''}
        ${prev && tl && prev !== tl ? `<span class="muted" title="label before refinement">was ${esc(prev)}</span>` : ''}
        ${c ? `<span class="chip" title="concept (r18)">${esc(conceptName(c))}</span>` : ''}
        ${q ? `<span class="chip ${q}" title="review priority (r21)">${q}</span>` : ''}
        ${fl ? `<span class="chip human" title="human label (r24)">✓ ${esc(fl)}</span>` : ''}
      </div>
      <div class="muted">${esc(find(S.captions, img.id)?.text || '')}</div>
      ${meter('support', find(S.rationaleScores, img.id)?.score, '#2f9e5b')}
      ${meter('uncertainty', find(S.noteScores, img.id)?.score, '#e07b39')}
    </div>`;
  }).join('')}</div>`;
}

// ---------- right: inspector (process 3 review, process 4 ask) ----------
function renderInspector() {
  const id = ui.currentItem;
  const img = S.images.find((i) => i.id === id);
  if (!img) return '<div class="empty">Select an image to inspect, review and ask about it.</div>';
  const tl = taskLabel(id);
  const fl = find(S.finalLabels, id)?.label;
  const r = ui.review[id] || (ui.review[id] = { verdict: null, comment: '', label: fl || tl || S.labelSpace[0] });
  const reply = S.assistantReply?.imageId === id ? S.assistantReply : null;
  if (reply && ui.judge.label === null) ui.judge.label = reply.suggestedLabel;
  const ex = S.labeledExamples.find((e) => e.imageId === id);
  const regs = S.regions.filter((x) => x.imageId === id);
  const opts = (sel) => S.labelSpace.map((l) => `<option ${l === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

  return `
  <h2>${esc(id)} ${fl ? `<span class="chip human">✓ ${esc(fl)}</span>` : ''}</h2>
  <div class="imgwrap"><img src="/images/${esc(img.file)}">${boxesSvg(img)}</div>
  <div class="muted">${regs.map((x) => esc(S.objectLabels.find((l) => l.regionId === x.id)?.label)).join(', ') || 'no annotated regions'}</div>
  ${find(S.descriptions, id) ? `<p>${esc(find(S.descriptions, id).text)}</p>` : ''}
  ${tl ? `<div class="card">
    <div><b>Model label:</b> <span class="chip ${esc(tl)}">${esc(tl)}</span> ${find(S.conceptLabels, id) ? `<span class="chip">${esc(conceptName(find(S.conceptLabels, id).conceptId))}</span>` : ''}</div>
    ${find(S.rationales, id) ? `<div style="margin-top:4px"><b>Rationale:</b> ${esc(find(S.rationales, id).text)}</div>` : ''}
    ${meter('support', find(S.rationaleScores, id)?.score, '#2f9e5b')}
    ${find(S.reviewNotes, id) ? `<div style="margin-top:4px"><b>Check:</b> ${esc(find(S.reviewNotes, id).text)}</div>` : ''}
    ${meter('uncertainty', find(S.noteScores, id)?.score, '#e07b39')}
  </div>` : ''}

  <h2>3 · Review <span class="tag">r23 evaluation · r24 label</span></h2>
  <div class="card">
    <div class="row">
      <button class="good ${r.verdict === 'agree' ? 'on' : ''}" data-verdict="agree" ${!tl ? 'disabled' : ''}>Agree with model</button>
      <button class="bad ${r.verdict === 'disagree' ? 'on' : ''}" data-verdict="disagree" ${!tl ? 'disabled' : ''}>Disagree</button>
    </div>
    <input type="text" id="rcomment" placeholder="Why? (optional comment)" value="${esc(r.comment)}">
    <div class="row"><span class="muted">Final label</span><select id="rlabel" style="width:auto">${opts(r.label)}</select>
      <button class="primary" data-act="p3" ${!r.verdict || busy() ? 'disabled' : ''}>Save review</button></div>
  </div>

  <h2>4 · Ask the assistant <span class="tag">r27 → r28</span></h2>
  <div class="card">
    <textarea id="question" rows="2" placeholder="e.g. Is the person on the road or on the sidewalk?">${esc(ui.question)}</textarea>
    <div class="row"><button data-act="p4ask" ${!ui.question.trim() || busy() ? 'disabled' : ''}>Ask</button></div>
    ${reply ? `<div class="reply"><div class="muted">Q: ${esc(reply.question)}</div>${esc(reply.text)}<div>Suggested: <span class="chip ${esc(reply.suggestedLabel)}">${esc(reply.suggestedLabel)}</span></div></div>
    ${S.replyReview?.imageId === id ? '<div class="muted">Reply judged and label recorded.</div>' : `
    <div class="row">
      <button class="good ${ui.judge.helpful === true ? 'on' : ''}" data-helpful="1">Helpful</button>
      <button class="bad ${ui.judge.helpful === false ? 'on' : ''}" data-helpful="0">Not helpful</button>
    </div>
    <input type="text" id="jcomment" placeholder="Feedback on the answer (optional)" value="${esc(ui.judge.comment)}">
    <div class="row"><span class="muted">Label</span><select id="jlabel" style="width:auto">${opts(ui.judge.label)}</select>
      <button class="primary" data-act="p4judge" ${ui.judge.helpful === null || busy() ? 'disabled' : ''}>Confirm</button></div>`}` : ''}
  </div>
  ${ex ? `<details><summary>Labeled example record (r25)</summary><pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify(ex, null, 1))}</pre></details>` : ''}
  `;
}

function render() {
  if (!S) return;
  const j = S.job;
  $('#jobbar').innerHTML = j?.running ? `<span class="spin"></span>${esc(j.name)}… ${esc(S.log.at(-1)?.msg || '')}`
    : ui.error ? `<span style="color:#ffb4a8">${esc(ui.error)}</span>`
      : j?.error ? `<span style="color:#ffb4a8">${esc(j.name)} failed: ${esc(j.error)}</span>` : (j ? `${esc(j.name)} ✓` : '');
  const scrollT = $('#task').scrollTop, scrollI = $('#inspector').scrollTop, scrollG = $('#gallery').scrollTop;
  $('#task').innerHTML = renderTask();
  $('#gallery').innerHTML = renderGallery();
  $('#inspector').innerHTML = renderInspector();
  $('#task').scrollTop = scrollT; $('#inspector').scrollTop = scrollI; $('#gallery').scrollTop = scrollG;
  $('#log').innerHTML = S.log.slice(-30).reverse().map((l) => `<div>${esc(l.at.slice(11, 19))} ${esc(l.msg)}</div>`).join('');
}

// ---------- events ----------
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'instruction') ui.instructionDraft = t.value;
  if (t.id === 'question') { ui.question = t.value; document.querySelector('[data-act="p4ask"]').disabled = !t.value.trim() || busy(); }
  if (t.id === 'rcomment') ui.review[ui.currentItem].comment = t.value;
  if (t.id === 'jcomment') ui.judge.comment = t.value;
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'boxes') { ui.showBoxes = t.checked; render(); }
  if (t.id === 'rlabel') ui.review[ui.currentItem].label = t.value;
  if (t.id === 'jlabel') ui.judge.label = t.value;
  if (t.dataset.guide) {
    const set = new Set(ui.checked ?? S.activeGuidelines);
    t.checked ? set.add(t.dataset.guide) : set.delete(t.dataset.guide);
    ui.checked = [...set];
    render();
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'upload') return;
  e.preventDefault();
  const res = await fetch('/api/dataset/upload', { method: 'POST', body: new FormData(e.target) });
  const d = await res.json();
  ui.error = res.ok ? '' : d.error;
  ui.currentItem = null;
  await refresh(true);
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .item');
  if (!t) return;
  if (t.dataset.item) { ui.currentItem = t.dataset.item; ui.question = ''; ui.judge = { helpful: null, comment: '', label: null }; render(); return; }
  if (t.dataset.filter) { ui.filter = t.dataset.filter; render(); return; }
  if (t.dataset.verdict) {
    const r = ui.review[ui.currentItem];
    r.verdict = t.dataset.verdict;
    if (r.verdict === 'agree') r.label = taskLabel(ui.currentItem) || r.label;
    render(); return;
  }
  if (t.dataset.helpful) { ui.judge.helpful = t.dataset.helpful === '1'; render(); return; }
  if (t.dataset.revert) { await act('/api/revert', { key: t.dataset.revert, v: Number(t.dataset.v) }); ui.instructionDraft = null; return; }
  const id = ui.currentItem;
  switch (t.dataset.act) {
    case 'demo': ui.currentItem = null; ui.checked = null; ui.review = {}; await act('/api/dataset/demo-load', {}); break;
    case 'p1': await act('/api/p1', {}); break;
    case 'p2suggest': {
      const text = ui.instructionDraft ?? S.instruction.current;
      if (text !== S.instruction.current) await act('/api/instruction', { text });
      ui.instructionDraft = null; ui.selectionMode = 'p2'; ui.checked = null;
      await act('/api/p2/suggest', {}); break;
    }
    case 'p2run': await act('/api/p2/run', { activeGuidelines: ui.checked ?? S.activeGuidelines }); ui.checked = null; break;
    case 'p7suggest': {
      const text = ui.instructionDraft ?? S.instruction.current;
      ui.instructionDraft = null; ui.selectionMode = 'p7'; ui.checked = null;
      await act('/api/p7/suggest', { instruction: text }); break;
    }
    case 'p7run': await act('/api/p7/run', { activeGuidelines: ui.checked ?? S.activeGuidelines }); ui.checked = null; break;
    case 'p3': {
      const r = ui.review[id];
      await act('/api/p3/review', { imageId: id, verdict: r.verdict, comment: r.comment, label: r.label });
      delete ui.review[id]; break;
    }
    case 'p4ask': ui.judge = { helpful: null, comment: '', label: null }; await act('/api/p4/ask', { imageId: id, question: ui.question }); break;
    case 'p4judge': await act('/api/p4/judge', { helpful: ui.judge.helpful, comment: ui.judge.comment, label: ui.judge.label }); break;
    case 'p5': await act('/api/p5', {}); break;
    case 'p6': await act('/api/p6', {}); break;
    default:
  }
});

refresh(true);
