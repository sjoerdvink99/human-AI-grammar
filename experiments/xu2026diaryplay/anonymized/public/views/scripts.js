// Process 3 — Scripts: events (r12*) → scripts (r13*) → assigned (r13_2) → edited (r13_3) → gameSpec (r14).
import { app, save, model, toast, esc, loading, rerender, setTab } from '../app.js';
import { regionAt } from '../tools/layout.js';
import { composeGame, VERBS, EFFECT_TYPES } from '../tools/engine.js';

const P = () => app.project;
const placementRegions = () => Object.fromEntries(Object.entries(P().placement).map(([id, pos]) => [id, regionAt(P().map, pos)?.id || null]));
const world = () => {
  const p = P();
  return { story: p.story, map: p.map, regionLabels: p.regionLabels, placementRegions: placementRegions(), objects: p.objects, characters: p.characters };
};

async function buildScripts() {
  const p = P();
  try {
    // [model extract] r1 + r7_2 + r6_3* + r3_3* → r12*
    const ev = await model('extractEvents', world());
    p.events = ev.events;
    p.scripts = [];
    save();
    rerender();
    // [model compose] … + r12* → r13*
    const co = await model('composeScripts', { ...world(), events: p.events });
    p.scripts = co.scripts;
    save();
    rerender();
    // [model assign] r13_1 → r13_2
    const as = await model('assignScripts', { ...world(), scripts: p.scripts });
    p.scripts = as.scripts;
    p.gameSpec = null;
    save();
    rerender();
  } catch (e) {
    toast(e.message, true);
  }
}

function compile() {
  const p = P();
  try {
    // [tool_2 compose] r1 + r7_2 + r3_3* + r13_3* → r14
    p.gameSpec = composeGame({ title: p.title, story: p.story, map: p.map, regionLabels: p.regionLabels, characters: p.characters, objects: p.objects, placement: p.placement, scripts: p.scripts });
    app.play = null;
    save();
    toast('Game compiled');
    setTab('play');
  } catch (e) {
    toast(e.message, true);
  }
}

const EFFECT_FIELDS = {
  narrate: ['text'], set_flag: ['flag'], give_item: ['object'], remove_object: ['object'],
  reveal_object: ['object'], move_character: ['character', 'region'], end_story: ['text'],
};

export function renderScripts(el) {
  const p = P();
  const busy = app.busy.extractEvents || app.busy.composeScripts || app.busy.assignScripts;
  const regionName = (rid) => p.regionLabels.find((l) => l.regionId === rid)?.name || rid;
  const name = (id) => p.characters.find((c) => c.id === id)?.name || p.objects.find((o) => o.id === id)?.name || regionName(id) || id;
  const opt = (items, sel, none) => `${none ? `<option value="">${none}</option>` : ''}${items.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  const chars = p.characters.map((c) => [c.id, `${c.emoji} ${c.name}`]);
  const npcs = p.characters.filter((c) => !c.isPlayer).map((c) => [c.id, `${c.emoji} ${c.name}`]);
  const objs = p.objects.map((o) => [o.id, `${o.emoji} ${o.name}`]);
  const regs = p.map.regions.map((r) => [r.id, regionName(r.id)]);
  const field = (e, f, si, ei) => {
    const attr = `data-s="${si}" data-e="${ei}" data-ef="${f}"`;
    if (f === 'text') return `<input type="text" class="grow" ${attr} value="${esc(e.text || '')}" placeholder="text">`;
    if (f === 'flag') return `<input type="text" ${attr} value="${esc(e.flag || '')}" placeholder="flag name" style="width:180px">`;
    if (f === 'object') return `<select ${attr} style="width:180px">${opt(objs, e.object, '— object —')}</select>`;
    if (f === 'character') return `<select ${attr} style="width:160px">${opt(chars, e.character, '— character —')}</select>`;
    if (f === 'region') return `<select ${attr} style="width:160px">${opt(regs, e.region, '— place —')}</select>`;
    return '';
  };

  el.innerHTML = `
  <div class="cols">
    <div>
      <div class="panel">
        <h2>Story scripts</h2>
        <p class="hint">The AI reads the story's events and turns them into scripts: when the player does <i>X</i>, these effects happen. Flags chain scripts into the story's order.</p>
        <div class="row"><button id="build" ${busy ? 'disabled' : ''}>${p.scripts.length ? 'Rebuild scripts from story' : 'Turn story into scripts'}</button>
          ${loading('extractEvents', 'Finding the story events…')}${loading('composeScripts', 'Composing scripts…')}${loading('assignScripts', 'Assigning characters and places…')}</div>
      </div>
      ${p.scripts.map((s, si) => `
      <div class="card">
        <div class="head"><b>#${si + 1}</b><input type="text" class="grow" data-s="${si}" data-sf="title" value="${esc(s.title)}">
          <button class="link" data-del-s="${si}" title="Delete script">✕</button></div>
        <div class="row">When player
          <select data-s="${si}" data-tf="verb" style="width:90px">${opt(VERBS.map((v) => [v, v]), s.trigger.verb)}</select>
          ${s.trigger.verb === 'give' ? `<select data-s="${si}" data-tf="item" style="width:170px">${opt(objs, s.trigger.item, '— item —')}</select> to` : ''}
          <select data-s="${si}" data-tf="target" style="width:180px">${opt(s.trigger.verb === 'go' ? regs : [...chars, ...objs], s.trigger.target, '— target —')}</select>
          if flags <input type="text" data-s="${si}" data-sf="requires" value="${esc((s.requires || []).join(', '))}" placeholder="none" style="width:170px">
          <label><input type="checkbox" data-s="${si}" data-sf="repeatable" ${s.repeatable ? 'checked' : ''}> repeatable</label>
        </div>
        <div class="row" style="margin:6px 0">Voiced by <select data-s="${si}" data-sf="npc" style="width:170px">${opt(npcs, s.npc, 'narrator')}</select>
          at <select data-s="${si}" data-sf="region" style="width:170px">${opt(regs, s.region, 'anywhere')}</select></div>
        <div class="effects">
          ${s.effects.map((e, ei) => `<div class="row"><span class="muted">then</span>
            <select data-s="${si}" data-e="${ei}" data-ef="type" style="width:140px">${opt(EFFECT_TYPES.map((t) => [t, t.replace('_', ' ')]), e.type)}</select>
            ${(EFFECT_FIELDS[e.type] || []).map((f) => field(e, f, si, ei)).join('')}
            <button class="link" data-del-e="${si}:${ei}">✕</button></div>`).join('')}
          <button class="secondary small" data-add-e="${si}">+ effect</button>
        </div>
      </div>`).join('')}
      ${p.scripts.length || p.events.length ? `<button class="secondary small" id="add-s">+ Add script</button>` : ''}
    </div>
    <div>
      ${p.events.length ? `<div class="panel"><h2>Story events <span class="step ai">AI-extracted</span></h2>
        <ol style="padding-left:18px;margin:0">${p.events.map((e) => `<li style="margin-bottom:6px">${esc(e.summary)}<br><span class="muted">${esc(name(e.actorId) || '')}${e.regionId ? ` · ${esc(regionName(e.regionId))}` : ''}${e.objectIds.length ? ` · ${e.objectIds.map((o) => esc(name(o))).join(', ')}` : ''}</span></li>`).join('')}</ol></div>` : ''}
      <div class="panel">
        <h2>Compile game <span class="step tool">engine</span></h2>
        <p class="hint">Combines map, places, characters, objects and scripts into one game definition.</p>
        <button id="compile" ${!p.scripts.length || busy ? 'disabled' : ''}>Compile & play →</button>
        ${p.gameSpec ? `<p class="hint">Compiled: ${p.gameSpec.scripts.length} scripts, ${p.gameSpec.objects.length} objects.</p>
          <details><summary class="muted">Game definition (JSON)</summary><pre class="spec">${esc(JSON.stringify(p.gameSpec, null, 1))}</pre></details>` : p.scripts.length ? '<p class="hint">Not compiled yet (or changed since last compile).</p>' : ''}
      </div>
    </div>
  </div>`;

  const q = (sel) => el.querySelector(sel);
  q('#build').onclick = buildScripts;
  q('#compile').onclick = compile;
  const changed = (structural) => { p.gameSpec = null; save(); if (structural) rerender(); };

  // human modify r13_2 → r13_3
  el.querySelectorAll('[data-sf]').forEach((inp) => inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input', () => {
    const s = p.scripts[inp.dataset.s];
    const f = inp.dataset.sf;
    if (f === 'requires') s.requires = inp.value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (f === 'repeatable') s.repeatable = inp.checked;
    else if (f === 'npc' || f === 'region') s[f] = inp.value || null;
    else s[f] = inp.value;
    changed(false);
  }));
  el.querySelectorAll('[data-tf]').forEach((inp) => inp.addEventListener('change', () => {
    const s = p.scripts[inp.dataset.s];
    s.trigger[inp.dataset.tf] = inp.value;
    if (inp.dataset.tf === 'verb') { s.trigger.target = ''; if (inp.value !== 'give') delete s.trigger.item; }
    changed(inp.dataset.tf === 'verb');
  }));
  el.querySelectorAll('[data-ef]').forEach((inp) => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
    const effects = p.scripts[inp.dataset.s].effects;
    const f = inp.dataset.ef;
    if (f === 'type') effects[inp.dataset.e] = { type: inp.value };
    else effects[inp.dataset.e][f] = inp.value;
    changed(f === 'type');
  }));
  el.querySelectorAll('[data-del-e]').forEach((b) => (b.onclick = () => {
    const [si, ei] = b.dataset.delE.split(':').map(Number);
    p.scripts[si].effects.splice(ei, 1);
    changed(true);
  }));
  el.querySelectorAll('[data-add-e]').forEach((b) => (b.onclick = () => { p.scripts[b.dataset.addE].effects.push({ type: 'narrate', text: '' }); changed(true); }));
  el.querySelectorAll('[data-del-s]').forEach((b) => (b.onclick = () => { p.scripts.splice(Number(b.dataset.delS), 1); changed(true); }));
  if (q('#add-s')) q('#add-s').onclick = () => {
    const n = Math.max(0, ...p.scripts.map((s) => Number(s.id.slice(1)) || 0)) + 1;
    p.scripts.push({ id: `s${n}`, title: 'New script', eventId: null, trigger: { verb: 'use', target: '' }, requires: [], effects: [{ type: 'narrate', text: '' }], repeatable: false, npc: null, region: null });
    changed(true);
  };
}
