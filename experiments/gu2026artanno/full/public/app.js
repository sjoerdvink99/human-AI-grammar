// System X frontend. One view; processes are flows within it (see README "Design → code").
const $app = document.getElementById('app');
let S = null;            // server state
let lastJson = '';
const ui = {
  leftTab: 'collection', taskId: null, newTask: '', focusedClusterId: null, focusedAt: null,
  review: {},            // clusterId → { feedback: {label: {verdict, comment}}, labels: [] }
  modalArtwork: null, chatFocus: null, question: '', asking: false, decisions: {}, // roundId → {verdict, note, labels}
  taxonomyEdit: null, toast: '', upload: { title: '', period: '', origin: '', notes: '' },
};

// ---------- helpers ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || r.statusText); throw new Error(j.error); }
  return j;
}
function toast(msg) { ui.toast = msg; render(); setTimeout(() => { if (ui.toast === msg) { ui.toast = ''; render(); } }, 5000); }
const art = (id) => S.artworks.find((a) => a.id === id);
const unit = (uid) => art(uid.split('.')[0])?.units?.find((u) => u.id === uid);
const task = () => S.tasks.find((t) => t.id === ui.taskId);
const spinner = () => h('span', { class: 'spin' });
function crop(u, big) {
  const a = art(u.id.split('.')[0]); const b = u.box;
  const pos = (p, s) => (s >= 1 ? 0 : (p / (1 - s)) * 100);
  return h('div', {
    class: 'crop' + (big ? ' big' : ''), title: `${u.id} · ${u.basicLabel}\n${u.description || ''}`,
    style: { backgroundImage: `url(/images/${a.file})`, backgroundSize: `${100 / Math.max(b.w, .02)}% ${100 / Math.max(b.h, .02)}%`, backgroundPosition: `${pos(b.x, b.w)}% ${pos(b.y, b.h)}%` },
    onclick: (e) => { e.stopPropagation(); ui.modalArtwork = { id: a.id, hl: u.id }; render(); },
  });
}
function artView(a, hl = []) {
  return h('div', { class: 'artview' }, h('img', { src: `/images/${a.file}`, alt: a.metadata.title }),
    (a.units || []).map((u) => h('div', { class: 'box' + (hl.includes(u.id) ? ' hl' : ''), style: { left: u.box.x * 100 + '%', top: u.box.y * 100 + '%', width: u.box.w * 100 + '%', height: u.box.h * 100 + '%' } }, h('span', {}, `${u.id.split('.')[1]} ${u.basicLabel}`))));
}
const stepList = (steps) => h('ul', { class: 'steps' }, steps.map((s) => h('li', { class: s.status }, s.name, s.status === 'running' ? [' ', spinner()] : '', s.endedAt && s.startedAt ? h('span', { class: 'muted' }, ` ${((s.endedAt - s.startedAt) / 1000).toFixed(0)}s`) : '', s.error ? h('div', { class: 'err' }, s.error) : '')));

// ---------- left column: collection (process 1), skills, knowledge, taxonomy ----------
function leftColumn() {
  const tabs = [['collection', 'Artworks'], ['skills', `Skills v${S.skillLibrary.version}`], ['knowledge', `Knowledge v${S.knowledgeBase.version}`], ['taxonomy', 'Labels']];
  return h('div', { class: 'col' }, h('div', { class: 'panel' },
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: 'small' + (ui.leftTab === k ? ' on' : ''), onclick: () => { ui.leftTab = k; render(); } }, l))),
    { collection, skills: skillsPanel, knowledge: knowledgePanel, taxonomy: taxonomyPanel }[ui.leftTab]()));
}
function collection() {
  const pending = S.artworks.filter((a) => ['new', 'error'].includes(a.status)).length;
  const busy = S.artworks.filter((a) => ['queued', 'detecting', 'describing'].includes(a.status)).length;
  const f = ui.upload;
  return h('div', {},
    h('h2', {}, 'Prepare artwork data'),
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('button', { class: 'primary', disabled: !pending, onclick: () => api('POST', '/api/prepare-all').then(refresh) }, `Prepare ${pending || ''}`.trim()),
      busy ? h('span', { class: 'small muted' }, spinner(), ` ${busy} running`) : h('span', { class: 'small muted' }, `${S.artworks.filter((a) => a.status === 'ready').length}/${S.artworks.length} ready`)),
    h('div', { class: 'grid-art' }, S.artworks.map((a) => h('div', {
      class: 'thumb' + (ui.chatFocus?.type === 'artwork' && ui.chatFocus.id === a.id ? ' focus' : ''), title: a.metadata.title,
      style: { backgroundImage: `url(/images/${a.file})` }, onclick: () => { ui.modalArtwork = { id: a.id }; render(); },
    }, h('span', { class: 'badge status-' + a.status }, a.status === 'ready' ? (a.units?.length || 0) + ' regions' : a.status)))),
    h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'small' }, 'Add artwork'),
      h('form', { onsubmit: async (e) => { e.preventDefault(); const fd = new FormData(e.target); await api('POST', '/api/artworks', fd); ui.upload = { title: '', period: '', origin: '', notes: '' }; refresh(); } },
        h('input', { type: 'file', name: 'image', accept: 'image/*', required: true }),
        ['title', 'period', 'origin', 'notes'].map((k) => h('input', { name: k, placeholder: k, value: f[k], oninput: (e) => (f[k] = e.target.value), style: { marginTop: '4px' } })),
        h('button', { type: 'submit', style: { marginTop: '6px' } }, 'Upload'))),
    h('div', { style: { marginTop: '10px' } }, h('button', { class: 'small', onclick: () => confirm('Reset everything (tasks, learned skills and knowledge) and reload the sample artworks?') && api('POST', '/api/seed').then(() => { ui.taskId = null; refresh(); }) }, 'Reset to sample data')));
}
function skillCard(s, extra) {
  return h('div', { class: 'skill' + (extra?.chosen ? ' chosen' : '') },
    h('div', { class: 'row' }, extra?.control, h('b', { class: 'grow' }, s.name), h('span', { class: 'chip' + (s.origin === 'seed' ? '' : ' green') }, s.origin === 'seed' ? 'seed' : 'learned'), h('span', { class: 'small muted' }, `v${s.version}`)),
    h('div', { class: 'small muted' }, s.applies_to, s.parent ? ` · branched from ${s.parent}` : ''),
    extra?.reason ? h('div', { class: 'small', style: { marginTop: '4px' } }, '→ ', extra.reason) : '',
    h('ol', {}, s.procedure.map((p) => h('li', {}, p))),
    s.cues?.length ? h('div', {}, s.cues.map((c) => h('span', { class: 'chip blue' }, c))) : '');
}
function skillsPanel() {
  return h('div', {}, h('h2', {}, `Skill library · v${S.skillLibrary.version}`),
    h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `${S.skillLibrary.skills.length} skills; ${S.skillLibrary.history.length} earlier version(s) kept`),
    S.skillLibrary.skills.map((s) => skillCard(s)));
}
function knowledgePanel() {
  const kb = S.knowledgeBase;
  return h('div', {}, h('h2', {}, `Knowledge base · v${kb.version}`),
    kb.entries.map((e) => h('div', { class: 'label-row' }, h('b', {}, e.concept), ' — ', e.meaning, h('div', { class: 'small muted' }, e.evidence, ' · ', e.source))));
}
function outline(n) { return h('li', {}, n.label, n.children?.length ? h('ul', {}, n.children.map(outline)) : ''); }
function taxonomyPanel() {
  if (ui.taxonomyEdit != null) return h('div', {}, h('h2', {}, 'Edit label taxonomy (JSON)'),
    h('textarea', { rows: 22, value: ui.taxonomyEdit, oninput: (e) => (ui.taxonomyEdit = e.target.value), id: 'tax-edit' }),
    h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'primary', onclick: async () => { let j; try { j = JSON.parse(ui.taxonomyEdit); } catch (e) { return toast('Invalid JSON: ' + e.message); } await api('PUT', '/api/taxonomy', j); ui.taxonomyEdit = null; refresh(); } }, 'Save'),
      h('button', { onclick: () => { ui.taxonomyEdit = null; render(); } }, 'Cancel')));
  return h('div', {}, h('h2', {}, 'Label taxonomy'), h('div', { class: 'outline' }, h('ul', {}, outline(S.labelTaxonomy))),
    h('button', { class: 'small', style: { marginTop: '8px' }, onclick: () => { ui.taxonomyEdit = JSON.stringify(S.labelTaxonomy, null, 2); render(); } }, 'Edit'));
}

// ---------- centre: task (process 2/7), clusters + review (process 3), learning (5+6) ----------
function centre() {
  const t = task();
  return h('div', { class: 'col' },
    h('div', { class: 'panel' },
      h('h2', {}, S.skillLibrary.version > 1 || S.knowledgeBase.version > 1 ? 'New annotation task (reuses learned skills & knowledge)' : 'Define annotation task'),
      h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); const r = await api('POST', '/api/tasks', { instruction: ui.newTask }); ui.newTask = ''; ui.taskId = r.id; ui.focusedClusterId = null; ui.chatFocus = null; refresh(); } },
        h('input', { id: 'new-task', class: 'grow', placeholder: 'Which implicit meaning do you want to label? e.g. "Wishes for longevity and blessings in gift artworks"', value: ui.newTask, oninput: (e) => (ui.newTask = e.target.value) }),
        h('button', { class: 'primary', type: 'submit' }, 'Start'))),
    t ? taskView(t) : h('div', { class: 'panel empty' }, S.tasks.length ? 'Select a task above.' : 'Prepare the artworks, then define a task to get skill suggestions, clusters and label recommendations.'));
}
function taskView(t) {
  const lib = S.skillLibrary.skills;
  const parts = [h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, t.instruction),
      h('span', { class: 'chip' + (t.pipeline === 'reuse' ? ' green' : '') }, t.pipeline === 'reuse' ? `reuse · skills v${t.libraryVersion} · knowledge v${t.kbVersion}` : 'first task'),
      h('span', { class: 'chip blue' }, t.status)),
    stepList(t.steps),
    t.status === 'error' ? h('div', { class: 'row' },
      h('button', { onclick: () => api('POST', `/api/tasks/${t.id}/suggest`).then(refresh) }, 'Retry skill suggestion'),
      t.chosenSkills.length ? h('button', { onclick: () => api('POST', `/api/tasks/${t.id}/skills`, { skillIds: t.chosenSkills }).then(refresh) }, 'Retry analysis') : '') : '')];

  if (t.suggestedSkills.length) {
    ui.chosen ||= {};
    const sel = (ui.chosen[t.id] ||= new Set(t.chosenSkills));
    const locked = t.status === 'analysing';
    parts.push(h('div', { class: 'panel' }, h('h2', {}, 'Suggested skills — choose which to use'),
      t.suggestedSkills.map((ss) => { const s = lib.find((k) => k.id === ss.skillId) || S.skillLibrary.history.flatMap((x) => x.skills).find((k) => k.id === ss.skillId); if (!s) return ''; return skillCard(s, { chosen: sel.has(s.id), reason: ss.reason, control: h('input', { type: 'checkbox', style: { width: 'auto' }, checked: sel.has(s.id), disabled: locked, onchange: (e) => { e.target.checked ? sel.add(s.id) : sel.delete(s.id); render(); } }) }); }),
      h('div', { class: 'row' }, h('button', { class: 'primary', disabled: !sel.size || locked, onclick: () => api('POST', `/api/tasks/${t.id}/skills`, { skillIds: [...sel] }).then(() => { ui.focusedClusterId = null; refresh(); }) }, t.clusters.length ? 'Re-run analysis with these skills' : 'Use selected skills & analyse'),
        h('span', { class: 'small muted' }, `${sel.size} selected`))));
  }
  if (t.clusters.length && t.status !== 'analysing') parts.push(clustersPanel(t));
  if (ui.focusedClusterId && t.clusters.find((c) => c.id === ui.focusedClusterId) && t.status === 'review') parts.push(reviewPanel(t));
  if (t.status === 'review') parts.push(learningPanel(t));
  return parts;
}
function clustersPanel(t) {
  const pri = t.priorityClusterIds || [];
  const order = [...pri.map((id) => t.clusters.find((c) => c.id === id)).filter(Boolean), ...t.clusters.filter((c) => !pri.includes(c.id))];
  return h('div', { class: 'panel' },
    h('h2', {}, pri.length ? `Clusters — ${pri.length} put forward for inspection` : 'Clusters'),
    h('div', { class: 'clusters' }, order.map((c) => {
      const conf = t.confirmed[`cluster:${c.id}`];
      return h('div', {
        class: 'ccard' + (pri.includes(c.id) ? ' priority' : '') + (ui.focusedClusterId === c.id ? ' focus' : '') + (conf ? ' done' : ''),
        onclick: () => { ui.focusedClusterId = c.id; ui.focusedAt = Date.now(); render(); document.getElementById('review')?.scrollIntoView({ behavior: 'smooth' }); },  // P3 human select
      },
        h('div', { class: 'row' }, h('b', { class: 'grow' }, c.name), pri.includes(c.id) ? h('span', { class: 'chip' }, `#${pri.indexOf(c.id) + 1}`) : ''),
        h('div', { class: 'crops' }, c.unitIds.slice(0, 8).map((id) => unit(id) && crop(unit(id))), c.unitIds.length > 8 ? h('span', { class: 'small muted' }, `+${c.unitIds.length - 8}`) : ''),
        h('div', {}, (c.recommendedLabels || []).map((l) => h('span', { class: 'chip' }, l))),
        c.priority ? h('div', { class: 'small muted' }, `priority ${c.priority.score.toFixed(2)} — ${c.priority.reason}`) : '',
        conf ? h('div', { class: 'small' }, '✓ ', conf.labels.map((l) => h('span', { class: 'chip green' }, l))) : '');
    })));
}
function reviewPanel(t) {
  const c = t.clusters.find((k) => k.id === ui.focusedClusterId);
  const conf = t.confirmed[`cluster:${c.id}`];
  const r = (ui.review[c.id] ||= {
    feedback: Object.fromEntries((t.feedback[c.id] || []).map((f) => [f.label, { verdict: f.verdict, comment: f.comment }])),
    labels: conf ? [...conf.labels] : [],
  });
  const setVerdict = (label, verdict) => {
    r.feedback[label] = { ...(r.feedback[label] || {}), verdict };
    if (verdict === 'accept' && !r.labels.includes(label)) r.labels.push(label);
    if (verdict === 'reject') r.labels = r.labels.filter((l) => l !== label);
    render();
  };
  const arts = [...new Set(c.unitIds.map((u) => u.split('.')[0]))];
  const other = (c.labelScores || []).filter((s) => !c.recommendedLabels.includes(s.label));
  return h('div', { class: 'panel', id: 'review' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, `Review: ${c.name}`),
      h('button', { class: 'small', onclick: () => { ui.chatFocus = { type: 'cluster', id: c.id }; render(); document.getElementById('question')?.focus(); } }, 'Ask chatbot about this cluster'),
      h('button', { class: 'small', onclick: () => { ui.focusedClusterId = null; render(); } }, 'Close')),
    h('p', { class: 'muted' }, c.pattern),
    h('div', { class: 'review-grid' },
      h('div', {},
        h('h2', {}, `Regions (${c.unitIds.length}) from ${arts.length} artwork(s)`),
        h('div', { class: 'crops' }, c.unitIds.map((id) => unit(id) && crop(unit(id), true))),
        h('div', { class: 'small muted' }, arts.map((id) => art(id)?.metadata.title).join(' · '))),
      h('div', {},
        h('h2', {}, 'Recommended labels'),
        c.recommendedLabels.map((l) => {
          const sc = c.labelScores.find((s) => s.label === l)?.score ?? 0; const fb = r.feedback[l] || {};
          return h('div', { class: 'label-row' },
            h('div', { class: 'row' }, h('b', { class: 'grow' }, l), h('span', { class: 'small muted' }, sc.toFixed(2))),
            h('div', { class: 'bar' }, h('i', { style: { width: sc * 100 + '%' } })),
            h('div', { class: 'small', style: { margin: '4px 0' } }, c.rationales?.[l] || ''),
            h('div', { class: 'row' }, ['accept', 'unsure', 'reject'].map((v) => h('button', { class: 'small' + (fb.verdict === v ? ' on' : ''), onclick: () => setVerdict(l, v) }, v)),
              h('input', { class: 'grow', placeholder: 'comment (optional)', value: fb.comment || '', id: `cm-${c.id}-${l}`, oninput: (e) => (r.feedback[l] = { ...(r.feedback[l] || {}), comment: e.target.value }) })));
        }),
        other.length ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Other scored: ', other.map((s) => h('span', { class: 'chip blue' }, `${s.label} ${s.score.toFixed(2)}`))) : '')),
    h('div', { class: 'label-row' },
      h('h2', {}, 'Confirmed labels for this cluster'),
      h('div', { class: 'row wrap' }, r.labels.length ? r.labels.map((l) => h('span', { class: 'chip green' }, l, h('button', { onclick: () => { r.labels = r.labels.filter((x) => x !== l); render(); } }, '×'))) : h('span', { class: 'empty' }, 'none — accept a recommendation or add a correction'),
        h('select', { style: { width: '220px' }, onchange: (e) => { if (e.target.value && !r.labels.includes(e.target.value)) r.labels.push(e.target.value); render(); } },
          h('option', { value: '' }, '+ add / correct label…'), S.labels.map((l) => h('option', { value: l }, l)))),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'primary', onclick: async () => {
          const feedback = Object.entries(r.feedback).map(([label, f]) => ({ label, verdict: f.verdict || 'unsure', comment: f.comment || '' }));
          await api('POST', `/api/tasks/${t.id}/review`, { clusterId: c.id, feedback, labels: r.labels, focusedAt: ui.focusedAt });
          toast(`Recorded decision for "${c.name}"`); refresh();
        } }, conf ? 'Update confirmation' : 'Confirm labels'),
        conf ? h('span', { class: 'small muted' }, `confirmed via ${conf.source}`) : '')));
}
function learningPanel(t) {
  const L = t.learning;
  return h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Learn from this task'),
      h('span', { class: 'small muted' }, `${t.logs.length} interactions recorded`),
      h('button', { class: 'primary', disabled: !t.logs.length || L?.status === 'running', onclick: () => api('POST', `/api/tasks/${t.id}/learn`).then(refresh) }, L ? 'Learn again' : 'Finish task & learn')),
    h('details', {}, h('summary', { class: 'small' }, 'Interaction log'), h('div', { class: 'log' }, t.logs.map((l) => `${l.t.slice(11, 19)} ${l.kind.toUpperCase()} ${l.target.type}:${l.target.id} ${l.kind === 'review' ? `→ [${l.data.confirmed.join(', ')}]` : `“${l.data.question}” → ${l.data.decision.verdict} [${l.data.labelsAfter.join(', ')}]`}`).join('\n') || 'empty')),
    L ? h('div', {},
      stepList(L.steps),
      L.error ? h('div', { class: 'err' }, L.error) : '',
      L.mined ? h('details', {}, h('summary', { class: 'small' }, `Mined behaviours (${L.mined.length})`), L.mined.map((b) => h('div', { class: 'diff' }, h('b', {}, b.behavior), h('div', { class: 'muted' }, b.procedure.join(' → '), ' · ', b.evidence)))) : '',
      L.differences ? h('details', { open: true }, h('summary', { class: 'small' }, 'Skill management decisions'), L.differences.map((d) => { const cand = L.candidates[Number(d.candidate.split('-')[1])]; return h('div', { class: 'diff' }, h('span', { class: 'chip' + (d.action === 'skip' ? '' : ' green') }, d.action), d.target_id ? h('span', { class: 'chip blue' }, d.target_id) : '', h('b', {}, cand?.name), h('div', { class: 'muted' }, d.difference)); })) : '',
      L.summary ? h('details', { open: true }, h('summary', { class: 'small' }, 'Task summary → knowledge base'), h('p', { class: 'small' }, L.summary), L.kbChanges ? h('div', { class: 'small muted' }, `${L.kbChanges.added} added, ${L.kbChanges.updated} updated`) : '') : '',
      L.status === 'done' ? h('div', { class: 'small' }, '✓ Skill library and knowledge base updated. Define a new task above to reuse them.') : '') : '');
}

// ---------- right: chatbot (process 4) ----------
function chatPanel() {
  const t = task();
  if (!t || t.status !== 'review') return h('div', { class: 'col' }, h('div', { class: 'panel' }, h('h2', {}, 'Chatbot'), h('div', { class: 'empty' }, 'Available once a task has clusters and recommendations.')));
  const f = ui.chatFocus;
  const focusName = f ? (f.type === 'artwork' ? art(f.id)?.metadata.title : t.clusters.find((c) => c.id === f.id)?.name) : null;
  const rounds = t.chat;
  return h('div', { class: 'col' }, h('div', { class: 'panel' },
    h('h2', {}, 'Ask the chatbot'),
    h('div', { class: 'small' }, 'About: ', f ? h('span', { class: 'chip blue' }, `${f.type} · ${focusName}`, h('button', { onclick: () => { ui.chatFocus = null; render(); } }, '×')) : h('span', { class: 'muted' }, 'select an artwork (open it → “Ask”) or a cluster')),
    h('select', { style: { margin: '6px 0' }, onchange: (e) => { const [type, id] = e.target.value.split(':'); ui.chatFocus = id ? { type, id } : null; render(); } },
      h('option', { value: '' }, 'choose focus…'),
      h('optgroup', { label: 'Clusters' }, t.clusters.map((c) => h('option', { value: `cluster:${c.id}`, selected: f?.type === 'cluster' && f.id === c.id }, c.name))),
      h('optgroup', { label: 'Artworks' }, S.artworks.filter((a) => a.status === 'ready').map((a) => h('option', { value: `artwork:${a.id}`, selected: f?.type === 'artwork' && f.id === a.id }, a.metadata.title)))),
    h('textarea', { id: 'question', rows: 3, placeholder: 'e.g. Why does this suggest longevity rather than reclusion? What visual evidence supports it?', value: ui.question, oninput: (e) => (ui.question = e.target.value), disabled: ui.asking }),
    h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'primary', disabled: !f || !ui.question.trim() || ui.asking, onclick: () => ask(t, f, ui.question) }, ui.asking ? [spinner(), ' thinking…'] : 'Ask'))),
    rounds.length ? h('div', { class: 'panel' }, [...rounds].reverse().map((r) => chatRound(t, r))) : '');
}
async function ask(t, focus, question) {
  ui.asking = true; render();
  try { await api('POST', `/api/tasks/${t.id}/chat`, { focus, question }); ui.question = ''; } finally { ui.asking = false; refresh(); }
}
function chatRound(t, r) {
  const key = `${r.focus.type}:${r.focus.id}`;
  const name = r.focus.type === 'artwork' ? art(r.focus.id)?.metadata.title : t.clusters.find((c) => c.id === r.focus.id)?.name;
  const d = (ui.decisions[r.id] ||= { verdict: null, note: '', labels: [...(t.confirmed[key]?.labels || [])] });
  return h('div', { class: 'chat-round' },
    h('div', { class: 'q' }, h('div', { class: 'small muted' }, `${r.focus.type} · ${name}`), r.question),
    r.status === 'thinking' ? h('div', {}, spinner(), ' thinking…') : '',
    r.status === 'error' ? h('div', {}, h('div', { class: 'err' }, r.error), h('button', { class: 'small', onclick: () => ask(t, r.focus, r.question) }, 'Ask again')) : '',
    r.answer ? h('div', {},
      h('div', { class: 'a' }, r.answer.answer),
      r.answer.comparisons?.length ? h('div', { class: 'small', style: { marginTop: '6px' } }, h('b', {}, 'Comparisons'), r.answer.comparisons.map((c) => h('div', { class: 'diff' }, h('b', {}, c.item), ': ', c.contrast))) : '',
      r.answer.suggested_labels?.length ? h('div', { class: 'small', style: { marginTop: '4px' } }, 'Suggested: ', r.answer.suggested_labels.map((l) => h('span', { class: 'chip' }, l))) : '') : '',
    r.status === 'answered' ? h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Your view:'), ['agree', 'unsure', 'disagree'].map((v) => h('button', { class: 'small' + (d.verdict === v ? ' on' : ''), onclick: () => { d.verdict = v; render(); } }, v)),
        h('button', { class: 'small', title: 'regenerate', onclick: () => ask(t, r.focus, r.question) }, '↻')),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Labels for this ${r.focus.type}:`),
      h('div', { class: 'row wrap' }, d.labels.map((l) => h('span', { class: 'chip green' }, l, h('button', { onclick: () => { d.labels = d.labels.filter((x) => x !== l); render(); } }, '×'))),
        (r.answer.suggested_labels || []).filter((l) => !d.labels.includes(l)).map((l) => h('button', { class: 'small', onclick: () => { d.labels.push(l); render(); } }, '+ ', l)),
        h('select', { style: { width: '160px' }, onchange: (e) => { if (e.target.value && !d.labels.includes(e.target.value)) d.labels.push(e.target.value); render(); } }, h('option', { value: '' }, '+ label…'), S.labels.map((l) => h('option', { value: l }, l)))),
      h('input', { placeholder: 'note (optional)', value: d.note, id: `note-${r.id}`, oninput: (e) => (d.note = e.target.value), style: { marginTop: '6px' } }),
      h('button', { class: 'primary small', style: { marginTop: '6px' }, disabled: !d.verdict, onclick: async () => { await api('POST', `/api/tasks/${t.id}/chat/${r.id}/decision`, d); toast('Decision recorded'); refresh(); } }, 'Save decision')) : '',
    r.decision ? h('div', { class: 'small', style: { marginTop: '6px' } }, `✓ ${r.decision.verdict} → `, r.decision.labels.map((l) => h('span', { class: 'chip green' }, l)), r.decision.note ? h('span', { class: 'muted' }, ` “${r.decision.note}”`) : '') : '');
}

// ---------- artwork modal (process 1 outputs; entry to process 4 for an artwork) ----------
function artworkModal() {
  const m = ui.modalArtwork; const a = m && art(m.id); if (!a) return '';
  const t = task();
  const clustersOf = t ? t.clusters.filter((c) => c.unitIds.some((u) => u.startsWith(a.id + '.'))) : [];
  const close = () => { ui.modalArtwork = null; render(); };
  return h('div', { class: 'modal', onclick: (e) => e.target === e.currentTarget && close() }, h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, a.metadata.title),
      t?.status === 'review' && a.status === 'ready' ? h('button', { class: 'small', onclick: () => { ui.chatFocus = { type: 'artwork', id: a.id }; close(); document.getElementById('question')?.focus(); } }, 'Ask chatbot about this artwork') : '',
      ['new', 'error', 'ready'].includes(a.status) ? h('button', { class: 'small', onclick: () => api('POST', `/api/artworks/${a.id}/prepare`).then(refresh) }, a.status === 'ready' ? 'Re-prepare' : 'Prepare') : '',
      h('button', { class: 'small', onclick: () => confirm('Remove this artwork?') && api('DELETE', `/api/artworks/${a.id}`).then(() => { close(); refresh(); }) }, 'Remove'),
      h('button', { class: 'small', onclick: close }, 'Close')),
    h('div', { class: 'review-grid' },
      h('div', {}, artView(a, m.hl ? [m.hl] : [])),
      h('div', {},
        h('div', { class: 'kv' }, Object.entries(a.metadata).map(([k, v]) => h('div', {}, h('b', {}, k + ': '), v))),
        a.status !== 'ready' ? h('p', {}, ['detecting', 'describing', 'queued'].includes(a.status) ? [spinner(), ' ', a.status] : a.status, a.error ? h('div', { class: 'err' }, a.error) : '') : '',
        a.description ? h('p', {}, a.description) : '',
        (a.units || []).map((u) => h('div', { class: 'label-row small', style: { background: m.hl === u.id ? 'var(--accent-soft)' : '' }, onmouseenter: () => { m.hl = u.id; render(); } },
          h('b', {}, `${u.id.split('.')[1]} · ${u.basicLabel}`), ' ', u.description || '')),
        clustersOf.length ? h('div', { style: { marginTop: '8px' } }, h('span', { class: 'small muted' }, 'In clusters: '), clustersOf.map((c) => h('span', { class: 'chip blue' }, c.name))) : '',
        t?.confirmed[`artwork:${a.id}`] ? h('div', { class: 'small' }, 'Confirmed for artwork: ', t.confirmed[`artwork:${a.id}`].labels.map((l) => h('span', { class: 'chip green' }, l))) : ''))));
}

// ---------- shell ----------
function render() {
  if (!S) return;
  const active = document.activeElement; const aid = active?.id; const sel = aid && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  const scrolls = [...document.querySelectorAll('.col')].map((c) => c.scrollTop);
  if (ui.taskId && !task()) ui.taskId = null;
  if (!ui.taskId && S.tasks.length) ui.taskId = S.tasks[S.tasks.length - 1].id;
  $app.replaceChildren(
    h('header', {}, h('h1', {}, 'System X'), h('span', { class: 'muted small grow' }, 'Annotating culturally implicit meanings in artworks'),
      S.tasks.length ? h('select', { style: { width: '320px' }, onchange: (e) => { ui.taskId = e.target.value; ui.focusedClusterId = null; ui.chatFocus = null; render(); } },
        S.tasks.map((t, i) => h('option', { value: t.id, selected: t.id === ui.taskId }, `Task ${i + 1}: ${t.instruction.slice(0, 50)}`))) : ''),
    h('div', { class: 'layout' }, leftColumn(), centre(), chatPanel()),
    artworkModal(),
    ui.toast ? h('div', { style: { position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', background: '#2a2622', color: '#fff', padding: '8px 14px', borderRadius: '8px', zIndex: 20 } }, ui.toast) : '');
  document.querySelectorAll('.col').forEach((c, i) => (c.scrollTop = scrolls[i] || 0));
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); if (sel) try { el.setSelectionRange(...sel); } catch {} } }
}
async function refresh() {
  const j = await fetch('/api/state').then((r) => r.text());
  if (j !== lastJson) { lastJson = j; S = JSON.parse(j); render(); }
}
const busy = () => S && (S.artworks.some((a) => ['queued', 'detecting', 'describing'].includes(a.status)) || S.tasks.some((t) => ['suggesting', 'analysing'].includes(t.status) || t.learning?.status === 'running' || t.chat.some((r) => r.status === 'thinking')));
setInterval(() => { if (busy()) refresh(); }, 1500);
refresh();
