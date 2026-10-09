// Process 1 — World: story (r1) + map templates (r2*) → characters, map, region names, objects, placement.
import { app, save, model, toast, esc, loading, rerender, setTab } from '../app.js';
import { MAP_TEMPLATES, COLS, ROWS, templateById } from '../data/templates.js';
import { EXAMPLE_STORY } from '../data/example.js';
import { layoutWorld, regionAt } from '../tools/layout.js';
import { drawMap, drawToken, TILE } from '../tools/render.js';

const P = () => app.project;
const AFF = ['take', 'use', 'open'];

const templateBrief = () => MAP_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, regions: t.regions.map((r) => ({ id: r.id, kind: r.kind, hint: r.hint })) }));
const placementRegions = () => Object.fromEntries(Object.entries(P().placement).map(([id, pos]) => [id, regionAt(P().map, pos)?.id || null]));

/* ---------- model chain A: extract → select → assign (stops for human modify of r5) ---------- */
async function buildWorld() {
  const p = P();
  if (p.story.trim().length < 80) return toast('Paste a story of at least a few sentences first.', true);
  try {
    // [model extract] r1 + r2* → r3*
    const ex = await model('extractCharacters', { story: p.story, templates: templateBrief() });
    Object.assign(p, { title: ex.title, characters: ex.characters, map: null, regionLabels: [], objects: [], placement: {}, events: [], scripts: [], gameSpec: null });
    save();
    await pickMap();
  } catch (e) {
    toast(e.message, true);
  }
}

async function pickMap() {
  const p = P();
  // [model select] r1 + r2* + r3* → r4
  const sel = await model('selectTemplate', { story: p.story, templates: templateBrief(), characters: p.characters });
  const t = templateById(sel.templateId);
  p.templateId = t.id;
  p.templateReason = sel.reason;
  p.map = { id: t.id, name: t.name, cols: COLS, rows: ROWS, regions: JSON.parse(JSON.stringify(t.regions)) };
  p.objects = [];
  p.placement = {};
  save();
  await nameRegions();
}

async function nameRegions() {
  const p = P();
  // [model assign] r1 + r4 + r3* → r5*
  const out = await model('assignRegionLabels', { story: p.story, map: p.map, characters: p.characters });
  p.regionLabels = out.labels;
  save();
  rerender();
}

/* ---------- model chain B: generate → tool_1 execute → assign (stops for human modify of r7, r6) ---------- */
async function populate() {
  const p = P();
  try {
    // [model generate]~ r1 + r4 + r3* + r5_2* → r6*
    const gen = await model('generateObjects', { story: p.story, map: p.map, regionLabels: p.regionLabels, characters: p.characters });
    // [tool_1 execute] → r7
    p.objects = gen.objects;
    p.placement = layoutWorld({ map: p.map, characters: p.characters, objects: p.objects, regionLabels: p.regionLabels });
    save();
    rerender();
    // [model assign] r1 + r7 + r3* + r6_1* → r6_2*
    const asg = await model('assignAffordances', { story: p.story, objects: p.objects, placementRegions: placementRegions(), characters: p.characters });
    p.objects = asg.objects;
    p.gameSpec = null;
    save();
    rerender();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- map canvas with drag-to-move (human modify r7_1 → r7_2) ---------- */
function drawWorld(canvas, highlight = null) {
  const p = P();
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const regions = p.map.regions.map((r) => ({ ...r, name: p.regionLabels.find((l) => l.regionId === r.id)?.name }));
  drawMap(ctx, regions, { highlight });
  for (const o of p.objects) if (p.placement[o.id]) drawToken(ctx, p.placement[o.id], { emoji: o.emoji, faded: o.hidden });
  for (const c of p.characters) if (p.placement[c.id]) drawToken(ctx, p.placement[c.id], { emoji: c.emoji, color: c.color, ring: c.isPlayer });
}

function attachDrag(canvas) {
  const p = P();
  let dragging = null;
  const cell = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * COLS), y: Math.floor(((e.clientY - r.top) / r.height) * ROWS) };
  };
  const at = (c) => [...p.characters, ...p.objects].reverse().find((e) => p.placement[e.id]?.x === c.x && p.placement[e.id]?.y === c.y);
  canvas.addEventListener('mousedown', (e) => {
    dragging = at(cell(e))?.id || null;
    if (dragging) canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragging) {
      canvas.title = at(cell(e))?.name || '';
      return;
    }
    const c = cell(e);
    if (c.x < 0 || c.y < 0 || c.x >= COLS || c.y >= ROWS) return;
    p.placement[dragging] = c;
    drawWorld(canvas, regionAt(p.map, c)?.id);
  });
  const end = () => {
    if (!dragging) return;
    const ob = p.objects.find((o) => o.id === dragging);
    if (ob) ob.region = regionAt(p.map, p.placement[ob.id])?.id || ob.region;
    dragging = null;
    canvas.style.cursor = 'grab';
    p.gameSpec = null;
    save();
    rerender();
  };
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
}

/* ---------- view ---------- */
export function renderWorld(el) {
  const p = P();
  const busyA = app.busy.extractCharacters || app.busy.selectTemplate || app.busy.assignRegionLabels;
  const busyB = app.busy.generateObjects || app.busy.assignAffordances;
  const regionName = (rid) => p.regionLabels.find((l) => l.regionId === rid)?.name || rid;
  const charRegion = (id) => regionName(regionAt(p.map, p.placement[id])?.id);

  el.innerHTML = `
  <div class="cols">
    <div>
      <div class="panel">
        <h2>Story <span class="step you">your text</span></h2>
        <textarea id="story" rows="${p.characters.length ? 6 : 14}" placeholder="Paste a short story (a few paragraphs)…">${esc(p.story)}</textarea>
        <div class="row" style="margin-top:8px">
          <button id="build" ${busyA ? 'disabled' : ''}>${p.characters.length ? 'Rebuild world from story' : 'Build world'}</button>
          <button id="example" class="secondary">Load example story</button>
          ${loading('extractCharacters', 'Finding characters…')}${loading('selectTemplate', 'Choosing a map…')}${loading('assignRegionLabels', 'Naming places…')}
        </div>
        ${p.characters.length && p.map ? '' : `<ul class="progress">
          <li class="${p.characters.length ? 'done' : app.busy.extractCharacters ? 'run' : 'todo'}">AI extracts characters</li>
          <li class="${p.map ? 'done' : app.busy.selectTemplate ? 'run' : 'todo'}">AI picks one of ${MAP_TEMPLATES.length} map templates</li>
          <li class="${p.regionLabels.length ? 'done' : app.busy.assignRegionLabels ? 'run' : 'todo'}">AI names the places on the map</li></ul>`}
      </div>
      ${p.map ? `
      <div class="panel">
        <h2>Map: ${esc(p.map.name)} <span class="step ai">AI-picked</span></h2>
        ${p.templateReason ? `<div class="ai-note">${esc(p.templateReason)}</div>` : ''}
        <canvas id="world-canvas"></canvas>
        <p class="hint">${p.objects.length ? 'Drag characters and objects to move them. Faded objects start hidden. The red ring marks the player.' : 'Name the places, then populate the world with objects.'}</p>
        <div class="row">
          <button class="secondary small" id="repick" ${busyA || busyB ? 'disabled' : ''}>Pick another map</button>
          <button id="populate" ${busyA || busyB || !p.regionLabels.length ? 'disabled' : ''}>${p.objects.length ? 'Regenerate objects' : 'Populate world with objects'}</button>
          ${loading('generateObjects', 'Generating objects…')}${loading('assignAffordances', 'Deciding what each object can do…')}
        </div>
      </div>` : ''}
      ${p.objects.length ? `
      <div class="panel">
        <h2>Objects <span class="step ai">AI-generated</span> <span class="step you">editable</span></h2>
        <table><thead><tr><th></th><th>Name</th><th>Description</th><th>Place</th><th>Player can</th><th>Owner</th><th>Hidden</th><th></th></tr></thead><tbody>
        ${p.objects.map((o) => `<tr data-obj="${o.id}">
          <td><input type="text" class="emoji-in" data-f="emoji" value="${esc(o.emoji)}"></td>
          <td><input type="text" data-f="name" value="${esc(o.name)}"></td>
          <td><input type="text" data-f="description" value="${esc(o.description)}"></td>
          <td class="muted">${esc(regionName(o.region))}</td>
          <td>${AFF.map((a) => `<label style="white-space:nowrap"><input type="checkbox" data-aff="${a}" ${o.affordances.includes(a) ? 'checked' : ''}> ${a}</label>`).join('<br>')}</td>
          <td><select data-f="owner"><option value="">—</option>${p.characters.map((c) => `<option value="${c.id}" ${o.owner === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
          <td><input type="checkbox" data-f="hidden" ${o.hidden ? 'checked' : ''}></td>
          <td><button class="link" data-del-obj="${o.id}" title="Remove">✕</button></td></tr>`).join('')}
        </tbody></table>
      </div>` : ''}
    </div>
    <div>
      ${p.regionLabels.length ? `
      <div class="panel">
        <h2>Places <span class="step ai">AI-named</span> <span class="step you">editable</span></h2>
        ${p.map.regions.map((r) => `<div class="row" style="margin-bottom:4px"><span class="muted" style="width:70px">${esc(r.hint)}</span>
          <input type="text" class="grow" data-region="${r.id}" value="${esc(regionName(r.id))}"></div>`).join('')}
        <div class="row" style="margin-top:6px"><button class="secondary small" id="rename" ${busyA ? 'disabled' : ''}>Suggest names again</button></div>
      </div>` : ''}
      ${p.characters.length ? `
      <div class="panel">
        <h2>Characters <span class="step ai">AI-extracted</span> <span class="step you">editable</span></h2>
        ${p.characters.map((c) => `<div class="card" data-char="${c.id}">
          <div class="head"><input type="text" class="emoji-in" data-f="emoji" value="${esc(c.emoji)}">
            <input type="text" class="grow" data-f="name" value="${esc(c.name)}">
            <label title="Player character"><input type="radio" name="player" data-player="${c.id}" ${c.isPlayer ? 'checked' : ''}> player</label>
            <button class="link" data-del-char="${c.id}" title="Remove">✕</button></div>
          <textarea rows="2" data-f="description">${esc(c.description)}</textarea>
          ${p.placement[c.id] ? `<div class="hint">in ${esc(charRegion(c.id))}${c.trait ? ` · ${esc(c.trait)}` : ''}</div>` : ''}
        </div>`).join('')}
        <div class="row"><button class="secondary small" id="add-char">+ Add character</button>
          <button class="small" id="to-chars">Refine characters →</button></div>
      </div>` : ''}
      ${p.objects.length ? `<div class="panel"><button id="to-scripts">Next: turn the story into scripts →</button></div>` : ''}
    </div>
  </div>`;

  const q = (s) => el.querySelector(s);
  q('#story').addEventListener('input', (e) => { p.story = e.target.value; save(); });
  q('#build').onclick = buildWorld;
  q('#example').onclick = () => { p.story = EXAMPLE_STORY; save(); rerender(); };
  if (q('#repick')) q('#repick').onclick = () => pickMap().catch((e) => toast(e.message, true));
  if (q('#rename')) q('#rename').onclick = () => nameRegions().catch((e) => toast(e.message, true));
  if (q('#populate')) q('#populate').onclick = populate;
  if (q('#to-chars')) q('#to-chars').onclick = () => setTab('characters');
  if (q('#to-scripts')) q('#to-scripts').onclick = () => setTab('scripts');

  const canvas = q('#world-canvas');
  if (canvas) { drawWorld(canvas); attachDrag(canvas); }

  // human modify r5: region names
  el.querySelectorAll('[data-region]').forEach((inp) => inp.addEventListener('input', () => {
    const l = p.regionLabels.find((x) => x.regionId === inp.dataset.region);
    l.name = inp.value.slice(0, 28);
    p.gameSpec = null;
    save();
    if (canvas) drawWorld(canvas, inp.dataset.region);
  }));
  // human modify r6: object fields
  el.querySelectorAll('[data-obj]').forEach((tr) => {
    const o = p.objects.find((x) => x.id === tr.dataset.obj);
    tr.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const f = inp.dataset.f;
      o[f] = inp.type === 'checkbox' ? inp.checked : f === 'owner' ? inp.value || null : inp.value;
      p.gameSpec = null;
      save();
      if (canvas) drawWorld(canvas);
    }));
    tr.querySelectorAll('[data-aff]').forEach((cb) => cb.addEventListener('change', () => {
      o.affordances = AFF.filter((a) => tr.querySelector(`[data-aff="${a}"]`).checked);
      p.gameSpec = null;
      save();
    }));
  });
  el.querySelectorAll('[data-del-obj]').forEach((b) => (b.onclick = () => {
    p.objects = p.objects.filter((o) => o.id !== b.dataset.delObj);
    delete p.placement[b.dataset.delObj];
    p.gameSpec = null;
    save();
    rerender();
  }));
  // human modify r3: characters
  el.querySelectorAll('[data-char]').forEach((card) => {
    const c = p.characters.find((x) => x.id === card.dataset.char);
    card.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
      c[inp.dataset.f] = inp.value;
      p.gameSpec = null;
      save();
      if (canvas && inp.dataset.f === 'emoji') drawWorld(canvas);
    }));
  });
  el.querySelectorAll('[data-player]').forEach((r) => r.addEventListener('change', () => {
    p.characters.forEach((c) => (c.isPlayer = c.id === r.dataset.player));
    p.gameSpec = null;
    save();
    rerender();
  }));
  el.querySelectorAll('[data-del-char]').forEach((b) => (b.onclick = () => {
    if (p.characters.length <= 1) return toast('Keep at least one character.', true);
    const wasPlayer = p.characters.find((c) => c.id === b.dataset.delChar)?.isPlayer;
    p.characters = p.characters.filter((c) => c.id !== b.dataset.delChar);
    if (wasPlayer) p.characters[0].isPlayer = true;
    delete p.placement[b.dataset.delChar];
    p.gameSpec = null;
    save();
    rerender();
  }));
  if (q('#add-char')) q('#add-char').onclick = () => {
    const n = Math.max(0, ...p.characters.map((c) => Number(c.id.slice(1)) || 0)) + 1;
    const ch = { id: `c${n}`, name: 'New character', description: '', emoji: '🧑', color: '#999999', isPlayer: false, persona: '', trait: '' };
    p.characters.push(ch);
    if (p.map) {
      const extra = layoutWorld({ map: p.map, characters: [ch], objects: [], regionLabels: p.regionLabels });
      p.placement[ch.id] = extra[ch.id];
    }
    p.gameSpec = null;
    save();
    rerender();
  };
}
