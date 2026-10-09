// Process 2 — Characters: request (r8) → persona (r9) → trait options (r10*) → chosen trait (r11) → updated characters (r3_3).
import { app, save, model, toast, esc, loading, rerender, setTab } from '../app.js';

const P = () => app.project;

export function renderCharacters(el) {
  const p = P();
  const s = p.p2;
  if (!p.characters.some((c) => c.id === s.characterId)) Object.assign(s, { characterId: p.characters[0]?.id || null, request: '', profile: '', traits: [], choice: null });
  const ch = p.characters.find((c) => c.id === s.characterId);
  const busy = app.busy.generateProfile || app.busy.generateTraits;

  el.innerHTML = `
  <div class="cols" style="grid-template-columns: 240px minmax(0,1fr)">
    <div class="panel char-list">
      <h2>Characters</h2>
      ${p.characters.map((c) => `<button data-pick="${c.id}" class="${c.id === s.characterId ? 'active' : ''}">${esc(c.emoji)} ${esc(c.name)}${c.isPlayer ? ' <span class="muted">(player)</span>' : ''}<br><span class="muted">${esc(c.trait || 'no trait yet')}</span></button>`).join('')}
    </div>
    ${ch ? `<div>
      <div class="panel">
        <h2>${esc(ch.emoji)} ${esc(ch.name)}</h2>
        <p class="muted" style="margin-top:0">${esc(ch.description)}</p>
        <h3>1 · What should this character be like? <span class="step you">you</span></h3>
        <textarea id="request" rows="2" placeholder="e.g. Make her gruff but secretly kind; she speaks in short sentences.">${esc(s.request)}</textarea>
        <div class="row" style="margin-top:6px"><button id="gen-profile" ${busy ? 'disabled' : ''}>${s.profile ? 'Regenerate persona' : 'Write persona'}</button>${loading('generateProfile', 'Writing persona…')}</div>

        ${s.profile ? `
        <h3>2 · Persona <span class="step ai">AI draft</span> <span class="step you">edit freely</span></h3>
        <textarea id="profile" rows="6">${esc(s.profile)}</textarea>
        <div class="row" style="margin-top:6px"><button id="gen-traits" ${busy ? 'disabled' : ''}>${s.traits.length ? 'Suggest other traits' : 'Suggest traits'}</button>${loading('generateTraits', 'Suggesting traits…')}</div>` : ''}

        ${s.traits.length ? `
        <h3>3 · Pick the trait that fits best <span class="step you">you</span></h3>
        <div class="chips">${s.traits.map((t) => `<button class="chip ${s.choice === t ? 'selected' : ''}" data-trait="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}

        ${s.choice ? `
        <h3>4 · Apply to ${esc(ch.name)} <span class="step you">review</span></h3>
        <label class="muted">Trait</label><input type="text" id="apply-trait" value="${esc(s.choice)}">
        <label class="muted">Persona</label><textarea id="apply-persona" rows="4">${esc(s.profile)}</textarea>
        <div class="row" style="margin-top:6px"><button id="apply">Apply to character</button></div>` : ''}
      </div>
      ${ch.persona ? `<div class="panel"><h2>Current persona</h2><p><b>${esc(ch.trait)}</b></p><p>${esc(ch.persona)}</p></div>` : ''}
      <div class="panel"><button class="secondary" id="to-scripts">Continue to scripts →</button></div>
    </div>` : ''}
  </div>`;

  const q = (sel) => el.querySelector(sel);
  el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => {
    Object.assign(s, { characterId: b.dataset.pick, request: '', profile: '', traits: [], choice: null });
    save();
    rerender();
  }));
  if (!ch) return;
  q('#to-scripts').onclick = () => setTab(p.objects.length ? 'scripts' : 'world');
  // human specify r8
  q('#request').addEventListener('input', (e) => { s.request = e.target.value; save(); });
  // [model generate]~ r1 + r3* + r8 → r9
  q('#gen-profile').onclick = async () => {
    try {
      const out = await model('generateProfile', { story: p.story, characters: p.characters, characterId: ch.id, request: s.request });
      Object.assign(s, { profile: out.profile, traits: [], choice: null });
      save();
      rerender();
    } catch (e) { toast(e.message, true); }
  };
  // human modify r9_1 → r9_2
  if (q('#profile')) q('#profile').addEventListener('input', (e) => { s.profile = e.target.value; save(); });
  // [model generate]~ r1 + r3* + r9_2 → r10*
  if (q('#gen-traits')) q('#gen-traits').onclick = async () => {
    try {
      const out = await model('generateTraits', { story: p.story, characters: p.characters, characterId: ch.id, profile: s.profile });
      Object.assign(s, { traits: out.traits, choice: null });
      save();
      rerender();
    } catch (e) { toast(e.message, true); }
  };
  // human select r10* → r11
  el.querySelectorAll('[data-trait]').forEach((b) => (b.onclick = () => { s.choice = b.dataset.trait; save(); rerender(); }));
  // human modify r3_2 → r3_3
  if (q('#apply')) q('#apply').onclick = () => {
    ch.trait = q('#apply-trait').value.trim().slice(0, 40);
    ch.persona = q('#apply-persona').value.trim().slice(0, 1500);
    Object.assign(s, { request: '', profile: '', traits: [], choice: null });
    p.gameSpec = null;
    save();
    toast(`${ch.name} updated`);
    rerender();
  };
}
