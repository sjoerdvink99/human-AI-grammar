// Application shell: shared state (named after the design's identifiers), persistence, tabs, API.
import { renderWorld } from './views/world.js';
import { renderCharacters } from './views/characters.js';
import { renderScripts } from './views/scripts.js';
import { renderPlay } from './views/play.js';

const KEY = 'story-world-project-v1';

export function emptyProject() {
  return {
    story: '',          // r1  artifact language
    title: '',
    characters: [],     // r3* artifact record
    templateId: null,
    templateReason: '',
    map: null,          // r4  artifact spatial (selected from r2*)
    regionLabels: [],   // r5* label language
    objects: [],        // r6* artifact record
    placement: {},      // r7  artifact spatial
    p2: { characterId: null, request: '', profile: '', traits: [], choice: null }, // r8, r9, r10*, r11
    events: [],         // r12* artifact record
    scripts: [],        // r13* artifact record
    gameSpec: null,     // r14 artifact record
  };
}

export const app = {
  project: load(),
  play: null,           // r15 gameState and friends, see views/play.js
  tab: 'world',
  busy: {},             // operation name → true while a model call runs
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyProject(), ...JSON.parse(raw) };
  } catch {}
  return emptyProject();
}
export function save() {
  localStorage.setItem(KEY, JSON.stringify(app.project));
}

/** Call one model operation on the backend. Tracks busy state for loading indicators. */
export async function model(op, body) {
  app.busy[op] = true;
  rerender();
  try {
    const res = await fetch(`/api/model/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${op} failed (${res.status})`);
    return data;
  } finally {
    delete app.busy[op];
    rerender();
  }
}

export function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  el.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.style.display = 'none'), isError ? 6000 : 2500);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const loading = (op, text) => (app.busy[op] ? `<span class="loading">${esc(text)}</span>` : '');

const VIEWS = { world: renderWorld, characters: renderCharacters, scripts: renderScripts, play: renderPlay };

export function setTab(tab) {
  app.tab = tab;
  rerender();
}

export function rerender() {
  const p = app.project;
  document.getElementById('story-title').textContent = p.title ? `— ${p.title}` : '';
  const enabled = { world: true, characters: p.characters.length > 0, scripts: p.objects.length > 0, play: !!p.gameSpec };
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('active', b.dataset.tab === app.tab);
    b.disabled = !enabled[b.dataset.tab];
  }
  for (const [name, fn] of Object.entries(VIEWS)) {
    const el = document.getElementById(`view-${name}`);
    el.classList.toggle('active', name === app.tab);
    if (name === app.tab) fn(el);
    else el.innerHTML = '';
  }
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('button')?.dataset.tab;
  if (t) setTab(t);
});
document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(app.project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(app.project.title || 'story-world').replace(/\W+/g, '-').toLowerCase()}.json`;
  a.click();
});
document.getElementById('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    app.project = { ...emptyProject(), ...JSON.parse(await file.text()) };
    app.play = null;
    save();
    setTab('world');
    toast('Project imported');
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
});
document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Start a new project? The current one will be discarded (export it first to keep it).')) return;
  app.project = emptyProject();
  app.play = null;
  save();
  setTab('world');
});

rerender();
