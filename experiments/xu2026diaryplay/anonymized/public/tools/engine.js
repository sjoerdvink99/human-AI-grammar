// tool_2: the deterministic game engine.
//   compose  (process 3): world pieces → gameSpec (r14)
//   execute  (process 4): gameSpec → gameState (r15); rule → updated gameState
//   select   (process 4): action (r18) → rule (r19)
//   evaluate (process 6): action (r18) → verdict (r23) ∈ {matched, unscripted, invalid}
// Rendering (the visual half of "execute") lives in render.js.
import { regionAt, freeCellIn } from './layout.js';

export const VERBS = ['go', 'look', 'take', 'use', 'open', 'talk', 'give'];
export const EFFECT_TYPES = ['narrate', 'set_flag', 'give_item', 'remove_object', 'reveal_object', 'move_character', 'end_story'];
export const VERDICTS = ['matched', 'unscripted', 'invalid'];

const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------------- compose: r13_3 + r7_2 + r3_3 (+ r1_1 for the title/intro) → r14 ---------------- */
export function composeGame({ title, story, map, regionLabels, characters, objects, placement, scripts }) {
  const nameOf = (rid) => regionLabels.find((l) => l.regionId === rid)?.name || rid;
  const player = characters.find((c) => c.isPlayer) || characters[0];
  if (!player) throw new Error('The story needs at least one character.');
  const fallback = map.regions[0].rect;
  const posOf = (id) => placement[id] || { x: fallback.x, y: fallback.y };
  return {
    title: title || 'Untitled story',
    intro: ((story || '').split(/\n\s*\n/).find((para) => para.trim().length > 80) || '').trim().slice(0, 400),
    map: {
      templateId: map.id,
      cols: map.cols,
      rows: map.rows,
      regions: map.regions.map((r) => ({ id: r.id, kind: r.kind, rect: { ...r.rect }, name: nameOf(r.id) })),
    },
    playerId: player.id,
    characters: characters.map((c) => ({ ...clone(c), start: posOf(c.id) })),
    objects: objects.map((o) => ({ ...clone(o), start: posOf(o.id) })),
    scripts: clone(scripts || []),
  };
}

/* ---------------- execute: r14 → r15 ---------------- */
export function startGame(spec) {
  const positions = {};
  for (const c of spec.characters) positions[c.id] = { ...c.start };
  for (const o of spec.objects) positions[o.id] = { ...o.start };
  const player = entity(spec, spec.playerId);
  return {
    turn: 0,
    positions,
    inventory: [],
    flags: [],
    fired: [],
    removed: [],
    hidden: spec.objects.filter((o) => o.hidden).map((o) => o.id),
    ended: false,
    log: [
      { turn: 0, kind: 'system', text: `${spec.title}` },
      { turn: 0, kind: 'narration', text: spec.intro || `You are ${player?.name}.` },
      { turn: 0, kind: 'narration', text: `You are ${player?.name}, in ${playerRegion(spec, { positions })?.name || 'the world'}.` },
    ],
  };
}

/* ---------------- queries ---------------- */
export function entity(spec, id) {
  return spec.characters.find((c) => c.id === id) || spec.objects.find((o) => o.id === id) || null;
}
export function region(spec, id) {
  return spec.map.regions.find((r) => r.id === id) || null;
}
export function playerRegion(spec, state) {
  return regionAt(spec.map, state.positions[spec.playerId]);
}
export function regionOf(spec, state, id) {
  return regionAt(spec.map, state.positions[id]);
}
export function adjacent(a, b) {
  if (a.id === b.id) return false;
  const A = a.rect, B = b.rect;
  const overlapX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
  const overlapY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
  const touchX = A.x + A.w === B.x || B.x + B.w === A.x;
  const touchY = A.y + A.h === B.y || B.y + B.h === A.y;
  return (touchX && overlapY > 0) || (touchY && overlapX > 0);
}
export function isVisibleObject(state, id) {
  return !state.removed.includes(id) && !state.hidden.includes(id) && !state.inventory.includes(id);
}
function inReach(spec, state, id) {
  if (state.inventory.includes(id)) return true;
  const here = playerRegion(spec, state);
  const isObj = spec.objects.some((o) => o.id === id);
  if (isObj && !isVisibleObject(state, id)) return false;
  return !!here && regionOf(spec, state, id)?.id === here.id;
}
export function labelFor(spec, action) {
  const t = action.target === 'around' ? 'around' : entity(spec, action.target)?.name || region(spec, action.target)?.name || action.target;
  if (action.verb === 'give') return `give ${entity(spec, action.item)?.name || action.item} to ${t}`;
  if (action.verb === 'go') return `go to ${t}`;
  if (action.verb === 'talk') return `talk to ${t}`;
  return `${action.verb} ${t}`;
}

/** All actions the engine considers reachable right now (used for menus and to constrain suggestions). */
export function availableActions(spec, state) {
  if (state.ended) return [];
  const here = playerRegion(spec, state);
  const out = [];
  const push = (a) => {
    const key = `${a.verb}|${a.target}|${a.item || ''}`;
    if (!out.some((b) => `${b.verb}|${b.target}|${b.item || ''}` === key)) out.push({ ...a, label: labelFor(spec, a) });
  };
  push({ verb: 'look', target: 'around' });
  if (here) for (const r of spec.map.regions) if (adjacent(here, r)) push({ verb: 'go', target: r.id });
  for (const o of spec.objects) {
    if (!inReach(spec, state, o.id)) continue;
    push({ verb: 'look', target: o.id });
    for (const v of o.affordances || []) if (v !== 'take' || !state.inventory.includes(o.id)) push({ verb: v, target: o.id });
  }
  for (const c of spec.characters) {
    if (c.id === spec.playerId || !inReach(spec, state, c.id)) continue;
    push({ verb: 'talk', target: c.id });
    push({ verb: 'look', target: c.id });
    for (const item of state.inventory) push({ verb: 'give', target: c.id, item });
  }
  for (const s of spec.scripts) {
    const t = s.trigger;
    if (!t || (state.fired.includes(s.id) && !s.repeatable)) continue;
    if (!(s.requires || []).every((f) => state.flags.includes(f))) continue;
    if (t.verb === 'go' ? here && region(spec, t.target) && adjacent(here, region(spec, t.target)) : inReach(spec, state, t.target)) {
      if (t.verb === 'give' && !state.inventory.includes(t.item)) continue;
      push({ verb: t.verb, target: t.target, ...(t.item ? { item: t.item } : {}) });
    }
  }
  return out;
}

/* ---------------- evaluate (process 6): r18 → r23 ---------------- */
export function evaluateAction(spec, state, action) {
  if (state.ended || !action || !VERBS.includes(action.verb)) return 'invalid';
  if (action.verb === 'go') {
    const here = playerRegion(spec, state);
    const there = region(spec, action.target);
    if (!there || !here || !adjacent(here, there)) return 'invalid';
  } else if (action.target !== 'around') {
    if (!entity(spec, action.target) || !inReach(spec, state, action.target)) return 'invalid';
    if (action.verb === 'give' && !state.inventory.includes(action.item)) return 'invalid';
  } else if (action.verb !== 'look') return 'invalid';
  return selectRule(spec, state, action) ? 'matched' : 'unscripted';
}

/* ---------------- select (process 4): r18 → r19 ---------------- */
export function selectRule(spec, state, action) {
  const script = spec.scripts.find(
    (s) =>
      s.trigger &&
      s.trigger.verb === action.verb &&
      s.trigger.target === action.target &&
      (!s.trigger.item || s.trigger.item === action.item) &&
      (s.requires || []).every((f) => state.flags.includes(f)) &&
      (s.repeatable || !state.fired.includes(s.id)),
  );
  if (script) return { kind: 'script', id: script.id, title: script.title, npc: script.npc || null, effects: clone(script.effects || []) };
  const target = entity(spec, action.target);
  if (action.verb === 'go') return { kind: 'builtin', id: 'go', effects: [] };
  if (action.verb === 'look') return { kind: 'builtin', id: 'look', effects: [] };
  if (action.verb === 'take' && target && (target.affordances || []).includes('take')) return { kind: 'builtin', id: 'take', effects: [] };
  return null;
}

/* ---------------- execute (process 4 loop): r15 + r19 → r15' ---------------- */
export function applyRule(spec, inState, rule, action) {
  const state = clone(inState);
  state.turn += 1;
  const log = (kind, text, speaker) => state.log.push({ turn: state.turn, kind, text, ...(speaker ? { speaker } : {}) });
  log('action', labelFor(spec, action));
  const occupied = () => new Set(Object.entries(state.positions).filter(([id]) => isVisibleObject(state, id) || !spec.objects.some((o) => o.id === id)).map(([, p]) => `${p.x},${p.y}`));
  const moveTo = (id, rid) => {
    const r = region(spec, rid);
    if (!r) return;
    const c = freeCellIn(r, occupied());
    state.positions[id] = { x: c.x, y: c.y };
  };

  if (rule.kind === 'builtin') {
    const t = entity(spec, action.target);
    if (rule.id === 'go') {
      moveTo(spec.playerId, action.target);
      log('narration', `You go to ${region(spec, action.target).name}.`);
    } else if (rule.id === 'look') {
      if (action.target === 'around') {
        const here = playerRegion(spec, state);
        const things = [...spec.characters, ...spec.objects]
          .filter((e) => e.id !== spec.playerId && regionOf(spec, state, e.id)?.id === here?.id && (!spec.objects.includes(e) || isVisibleObject(state, e.id)))
          .map((e) => e.name);
        log('narration', `${here?.name || 'Here'}: ${things.length ? `you see ${things.join(', ')}.` : 'nothing of note.'}`);
      } else log('narration', `${t.name}: ${t.description || 'nothing special.'}`);
    } else if (rule.id === 'take') {
      state.inventory.push(t.id);
      log('narration', `You take ${t.name}.`);
    }
  } else {
    state.fired.push(rule.id);
    for (const e of rule.effects) {
      switch (e.type) {
        case 'narrate':
          log(rule.npc ? 'speech' : 'narration', e.text, rule.npc || undefined);
          break;
        case 'set_flag':
          if (!state.flags.includes(e.flag)) state.flags.push(e.flag);
          break;
        case 'give_item':
          if (!state.inventory.includes(e.object)) state.inventory.push(e.object);
          state.hidden = state.hidden.filter((h) => h !== e.object);
          log('system', `You now have ${entity(spec, e.object)?.name || e.object}.`);
          break;
        case 'remove_object':
          if (!state.removed.includes(e.object)) state.removed.push(e.object);
          state.inventory = state.inventory.filter((i) => i !== e.object);
          break;
        case 'reveal_object':
          state.hidden = state.hidden.filter((h) => h !== e.object);
          log('system', `${entity(spec, e.object)?.name || e.object} appears.`);
          break;
        case 'move_character':
          moveTo(e.character, e.region);
          break;
        case 'end_story':
          state.ended = true;
          log('narration', e.text || 'The end.');
          break;
      }
    }
  }
  return state;
}
