// Processes 4, 5, 6 — Play.
//  4: gameSpec (r14) → gameState (r15) + view (r16) → suggestions (r17*) → action (r18) → rule (r19) → execute (loop) … → storybook (r20)
//  5: utterance (r21) → reply (r22) → view (r16_2)
//  6: action (r18) → verdict (r23) → narration (r24) → view (r16_3)
import { app, model, toast, esc, loading, rerender } from '../app.js';
import { startGame, availableActions, evaluateAction, selectRule, applyRule, playerRegion, regionOf, labelFor, VERBS } from '../tools/engine.js';
import { renderView, renderStorybook } from '../tools/render.js';

function newPlay(spec) {
  // [tool_2 execute] r14 → r15 (+ r16 drawn in render)
  const gameState = startGame(spec);
  return {
    spec,
    gameState,
    history: [],            // earlier r15 versions (for Undo)
    suggestions: [],        // r17*
    suggestionsTurn: -1,
    action: { verb: 'look', target: 'around' }, // r18 being built in the form
    verdict: null,          // r23
    rule: null,             // r19
    overlay: { type: 'narration', text: gameState.log[gameState.log.length - 1].text },
    extras: [],             // unscripted replies/narrations (r22, r24) — shown but never written into r15
    sayTo: null,
    storybook: false,       // r20 shown
  };
}

const where = (pl) => playerRegion(pl.spec, pl.gameState)?.name || 'somewhere';

/* ---------- process 4: [model generate]~ r1 + r14 + r15 + r16 → r17* ---------- */
async function refreshSuggestions() {
  const pl = app.play;
  if (pl.gameState.ended) return;
  const turn = pl.gameState.turn;
  if (pl.suggestionsTurn === turn) return;
  pl.suggestionsTurn = turn;
  pl.suggestions = [];
  try {
    const out = await model('suggestActions', { story: app.project.story, spec: pl.spec, state: pl.gameState, where: where(pl), available: availableActions(pl.spec, pl.gameState) });
    if (app.play === pl && pl.gameState.turn === turn) { pl.suggestions = out.suggestions; rerender(); }
  } catch (e) {
    toast(`Suggestions unavailable: ${e.message}`, true);
  }
}

/* ---------- human specify r18 → tool_2 evaluate → (4) select + execute | (6) model narrate ---------- */
async function doAction(action) {
  const pl = app.play;
  pl.action = { ...action };
  // [tool_2 evaluate] r14 + r15 + r18 → r23
  pl.verdict = evaluateAction(pl.spec, pl.gameState, action);
  if (pl.verdict === 'matched') {
    // [tool_2 select] r18 → r19
    pl.rule = selectRule(pl.spec, pl.gameState, action);
    // [tool_2 execute] r19 → r15 (loop back) + r16
    pl.history.push(pl.gameState);
    pl.gameState = applyRule(pl.spec, pl.gameState, pl.rule, action);
    const fresh = pl.gameState.log.filter((l) => l.turn === pl.gameState.turn && l.kind !== 'action');
    const speech = [...fresh].reverse().find((l) => l.kind === 'speech');
    const last = fresh[fresh.length - 1];
    pl.overlay = speech ? { type: 'speech', characterId: speech.speaker, text: speech.text } : last ? { type: 'narration', text: last.text } : null;
    rerender(); // re-render schedules refreshSuggestions() for the new turn (the loop)
    return;
  }
  // Process 6: [model generate]~ r14 + r15 + r23 → r24, then [tool_2 execute] → r16_3 (r15 unchanged)
  pl.rule = null;
  rerender();
  try {
    const out = await model('improviseNarration', { spec: pl.spec, state: pl.gameState, verdict: pl.verdict, actionLabel: labelFor(pl.spec, action), where: where(pl) });
    pl.extras.push({ afterTurn: pl.gameState.turn, afterLen: pl.gameState.log.length, kind: 'improv', text: `${labelFor(pl.spec, action)} — ${out.narration}` });
    pl.overlay = { type: 'narration', text: out.narration };
    rerender();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------- process 5: human specify r21 → [model generate]~ r22 → [tool_2 execute] r16_2 ---------- */
async function say(characterId, utterance) {
  const pl = app.play;
  if (!utterance.trim()) return;
  try {
    const out = await model('characterReply', { spec: pl.spec, state: pl.gameState, characterId, utterance, where: where(pl) });
    const name = pl.spec.characters.find((c) => c.id === characterId)?.name;
    pl.extras.push({ afterTurn: pl.gameState.turn, afterLen: pl.gameState.log.length, kind: 'reply', text: `You: “${utterance}” — ${name}: “${out.reply}”` });
    pl.overlay = { type: 'speech', characterId, text: out.reply };
    pl.utterance = '';
    rerender();
  } catch (e) {
    toast(e.message, true);
  }
}

function transcript(pl) {
  const out = [];
  const nameOf = (id) => pl.spec.characters.find((c) => c.id === id)?.name;
  pl.gameState.log.forEach((l, i) => {
    out.push(`<p class="${l.kind}">${l.kind === 'action' ? '▸ ' : ''}${l.speaker ? `<b>${esc(nameOf(l.speaker))}:</b> “${esc(l.text)}”` : esc(l.text)}</p>`);
    for (const x of pl.extras) if (x.afterLen === i + 1) out.push(`<p class="improv">${esc(x.text)}</p>`);
  });
  return out.join('');
}

export function renderPlay(el) {
  const spec = app.project.gameSpec;
  if (!spec) { el.innerHTML = '<div class="panel">Compile the game in the Scripts tab first.</div>'; return; }
  if (!app.play || app.play.spec !== spec) app.play = newPlay(spec);
  const pl = app.play;
  const gs = pl.gameState;
  if (pl.suggestionsTurn !== gs.turn && !gs.ended) setTimeout(refreshSuggestions, 0);

  const here = playerRegion(spec, gs);
  const npcsHere = spec.characters.filter((c) => c.id !== spec.playerId && regionOf(spec, gs, c.id)?.id === here?.id);
  if (!npcsHere.some((c) => c.id === pl.sayTo)) pl.sayTo = npcsHere[0]?.id || null;
  const a = pl.action;
  const targets = a.verb === 'go'
    ? spec.map.regions.map((r) => [r.id, r.name])
    : [...(a.verb === 'look' ? [['around', 'around']] : []), ...spec.characters.filter((c) => c.id !== spec.playerId).map((c) => [c.id, `${c.emoji} ${c.name}`]), ...spec.objects.map((o) => [o.id, `${o.emoji} ${o.name}`])];
  const opt = (items, sel) => items.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const busyAct = app.busy.improviseNarration;

  el.innerHTML = `
  <div class="cols" style="grid-template-columns: minmax(0,1fr) 400px">
    <div>
      <div class="panel">
        <h2>${esc(spec.title)} <span class="muted" style="font:13px system-ui">turn ${gs.turn} · ${esc(here?.name || '')}</span>
          ${pl.verdict ? `<span class="verdict ${pl.verdict}" title="engine verdict for your last action">${pl.verdict}</span>` : ''}</h2>
        <canvas id="play-canvas"></canvas>
        <div class="row" style="margin-top:8px">
          <span class="muted">Carrying:</span> ${gs.inventory.length ? gs.inventory.map((id) => { const o = spec.objects.find((x) => x.id === id); return `${esc(o?.emoji)} ${esc(o?.name)}`; }).join(', ') : '<span class="muted">nothing</span>'}
          <span class="grow"></span>
          <button class="secondary small" id="undo" ${pl.history.length ? '' : 'disabled'}>Undo</button>
          <button class="secondary small" id="restart">Restart</button>
          <button class="small" id="end">End story &amp; make storybook</button>
        </div>
      </div>
      ${pl.storybook ? `<div class="panel"><h2>Storybook</h2><canvas id="storybook-canvas"></canvas>
        <div class="row" style="margin-top:8px"><button id="download">Download PNG</button></div></div>` : ''}
    </div>
    <div>
      ${gs.ended ? '<div class="panel"><b>The story has ended.</b> Make the storybook, undo, or restart.</div>' : `
      <div class="panel">
        <h2>What next? <span class="step ai">AI suggestions</span></h2>
        <div class="suggestions">${pl.suggestions.map((s, i) => `<button data-sug="${i}" ${busyAct ? 'disabled' : ''}>${esc(s.label)} <span class="muted">· ${esc(labelFor(spec, s))}</span></button>`).join('')}
        ${loading('suggestActions', 'Thinking of options…')}</div>
        <h3>Or do something yourself</h3>
        <div class="row">
          <select id="verb" style="width:80px">${opt(VERBS.map((v) => [v, v]), a.verb)}</select>
          ${a.verb === 'give' ? `<select id="item" style="width:120px"><option value="">— item —</option>${opt(gs.inventory.map((id) => [id, spec.objects.find((o) => o.id === id)?.name]), a.item)}</select>` : ''}
          <select id="target" class="grow" style="width:150px"><option value="">— target —</option>${opt(targets, a.target)}</select>
          <button id="do" ${busyAct ? 'disabled' : ''}>Do</button>
        </div>
        ${loading('improviseNarration', 'Nothing scripted — the narrator improvises…')}
      </div>
      <div class="panel">
        <h2>Say something <span class="step you">free text</span></h2>
        ${npcsHere.length ? `<div class="row"><select id="say-to" style="width:130px">${opt(npcsHere.map((c) => [c.id, `${c.emoji} ${c.name}`]), pl.sayTo)}</select>
          <input type="text" id="utterance" class="grow" placeholder="Type what you say…" value="${esc(pl.utterance || '')}"><button id="say" ${app.busy.characterReply ? 'disabled' : ''}>Say</button></div>
          ${loading('characterReply', 'Listening…')}` : '<p class="hint">Nobody else is here.</p>'}
      </div>`}
      <div class="panel"><h2>Story so far</h2><div class="log" id="log">${transcript(pl)}</div>
        <p class="hint"><span class="improv" style="color:var(--ai)">Purple</span> lines are improvised by the AI and do not change the world.</p></div>
    </div>
  </div>`;

  const q = (s) => el.querySelector(s);
  renderView(q('#play-canvas'), spec, gs, pl.overlay);
  const log = q('#log');
  log.scrollTop = log.scrollHeight;

  el.querySelectorAll('[data-sug]').forEach((b) => (b.onclick = () => doAction(pl.suggestions[Number(b.dataset.sug)])));
  if (q('#verb')) {
    q('#verb').onchange = (e) => { pl.action = { verb: e.target.value, target: e.target.value === 'look' ? 'around' : '' }; rerender(); };
    q('#target').onchange = (e) => { pl.action.target = e.target.value; };
    if (q('#item')) q('#item').onchange = (e) => { pl.action.item = e.target.value; };
    q('#do').onclick = () => {
      if (!pl.action.target) return toast('Choose a target.', true);
      doAction({ ...pl.action });
    };
  }
  if (q('#say')) {
    q('#say-to').onchange = (e) => { pl.sayTo = e.target.value; };
    q('#utterance').addEventListener('input', (e) => { pl.utterance = e.target.value; });
    if (document.activeElement === document.body && pl.utterance) q('#utterance').focus();
    const go = () => say(q('#say-to').value, q('#utterance').value);
    q('#say').onclick = go;
    q('#utterance').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  q('#undo').onclick = () => {
    pl.gameState = pl.history.pop();
    pl.verdict = null;
    pl.overlay = null;
    pl.extras = pl.extras.filter((x) => x.afterLen <= pl.gameState.log.length);
    rerender();
  };
  q('#restart').onclick = () => { app.play = newPlay(spec); rerender(); };
  // final [tool_2 execute] → r20
  q('#end').onclick = () => { pl.storybook = true; rerender(); q('#storybook-canvas')?.scrollIntoView({ behavior: 'smooth' }); };
  if (pl.storybook) {
    const sb = el.querySelector('#storybook-canvas');
    renderStorybook(sb, spec, gs);
    q('#download').onclick = () => {
      const link = document.createElement('a');
      link.download = `${spec.title.replace(/\W+/g, '-').toLowerCase()}-storybook.png`;
      link.href = sb.toDataURL('image/png');
      link.click();
    };
  }
}
