import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_TEMPLATES, COLS, ROWS } from '../public/data/templates.js';
import { layoutWorld, regionAt } from '../public/tools/layout.js';
import { composeGame, startGame, evaluateAction, selectRule, applyRule, availableActions, adjacent, playerRegion } from '../public/tools/engine.js';
import { validateScripts } from '../server/operations.js';

const t = MAP_TEMPLATES.find((m) => m.id === 'harbor');
const map = { id: t.id, name: t.name, cols: COLS, rows: ROWS, regions: t.regions };
const regionLabels = t.regions.map((r) => ({ regionId: r.id, name: r.hint }));
const characters = [
  { id: 'c1', name: 'Pip', description: 'apprentice in the lighthouse', emoji: '🧒', color: '#f00', isPlayer: true },
  { id: 'c2', name: 'Greta', description: 'runs the tavern', emoji: '👩', color: '#0f0', isPlayer: false },
];
const objects = [
  { id: 'o1', name: 'coin', description: 'a copper coin', emoji: '🪙', region: 'R4', affordances: ['take'], owner: null, hidden: false },
  { id: 'o2', name: 'wick', description: 'a new wick', emoji: '🕯️', region: 'R2', affordances: ['take'], owner: 'c2', hidden: true },
];

test('every template tiles the grid without overlaps and is connected', () => {
  for (const tpl of MAP_TEMPLATES) {
    const seen = new Set();
    for (const r of tpl.regions) for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++) {
      assert.ok(x < COLS && y < ROWS, `${tpl.id} out of bounds`);
      assert.ok(!seen.has(`${x},${y}`), `${tpl.id} overlap at ${x},${y}`);
      seen.add(`${x},${y}`);
    }
    const reach = new Set([tpl.regions[0].id]);
    for (let k = 0; k < tpl.regions.length; k++) for (const a of tpl.regions) for (const b of tpl.regions) if (reach.has(a.id) && adjacent(a, b)) reach.add(b.id);
    assert.equal(reach.size, tpl.regions.length, `${tpl.id} not connected`);
  }
});

test('tool_1 layout places characters by mentioned region and objects in their region, without collisions', () => {
  const pl = layoutWorld({ map, characters, objects, regionLabels });
  assert.equal(regionAt(map, pl.c1).hint, 'lighthouse');
  assert.equal(regionAt(map, pl.c2).hint, 'tavern');
  assert.equal(regionAt(map, pl.o2).id, 'R2');
  const cells = Object.values(pl).map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(cells).size, cells.length);
});

function game() {
  const placement = layoutWorld({ map, characters, objects, regionLabels });
  const scripts = validateScripts([
    { title: 'Buy wick', trigger: { verb: 'give', target: 'c2', item: 'o1' }, requires: [], effects: [
      { type: 'narrate', text: 'Here is your wick.' }, { type: 'remove_object', object: 'o1' }, { type: 'give_item', object: 'o2' }, { type: 'set_flag', flag: 'has_wick' }] },
    { title: 'Bad', trigger: { verb: 'use', target: 'nope' }, effects: [{ type: 'narrate', text: 'x' }] },
    { title: 'Light', trigger: { verb: 'talk', target: 'c2' }, requires: ['has_wick'], effects: [{ type: 'end_story', text: 'The light shines.' }] },
  ], { characters, objects, map });
  return composeGame({ title: 'T', story: 'Intro.\n\nMore.', map, regionLabels, characters, objects, placement, scripts });
}

test('validateScripts drops scripts with unknown ids', () => {
  assert.equal(game().scripts.length, 2);
});

test('tool_2 evaluate/select/execute play through a scripted story', () => {
  const spec = game();
  let s = startGame(spec);
  assert.equal(playerRegion(spec, s).name, 'lighthouse');
  assert.ok(s.hidden.includes('o2'));
  // take coin (built-in, same region)
  const take = { verb: 'take', target: 'o1' };
  assert.equal(evaluateAction(spec, s, take), 'matched');
  s = applyRule(spec, s, selectRule(spec, s, take), take);
  assert.deepEqual(s.inventory, ['o1']);
  // talking to Greta from the lighthouse is invalid (not in reach)
  assert.equal(evaluateAction(spec, s, { verb: 'talk', target: 'c2' }), 'invalid');
  // walk to the tavern: lighthouse (R4) → ship (R5)? tavern (R2) is adjacent to lighthouse
  const go = { verb: 'go', target: 'R2' };
  assert.equal(evaluateAction(spec, s, go), 'matched');
  s = applyRule(spec, s, selectRule(spec, s, go), go);
  assert.equal(playerRegion(spec, s).id, 'R2');
  // talk before the flag: valid but unscripted → model improvises (process 6)
  assert.equal(evaluateAction(spec, s, { verb: 'talk', target: 'c2' }), 'unscripted');
  assert.ok(availableActions(spec, s).some((a) => a.verb === 'give' && a.item === 'o1'));
  const give = { verb: 'give', target: 'c2', item: 'o1' };
  const rule = selectRule(spec, s, give);
  assert.equal(rule.kind, 'script');
  s = applyRule(spec, s, rule, give);
  assert.deepEqual(s.inventory, ['o2']);
  assert.ok(s.flags.includes('has_wick'));
  assert.equal(evaluateAction(spec, s, give), 'invalid'); // coin is gone
  const talk = { verb: 'talk', target: 'c2' };
  s = applyRule(spec, s, selectRule(spec, s, talk), talk);
  assert.equal(s.ended, true);
  assert.equal(evaluateAction(spec, s, { verb: 'look', target: 'around' }), 'invalid');
});

test('applyRule never mutates the previous state (earlier versions are kept)', () => {
  const spec = game();
  const s0 = startGame(spec);
  const snapshot = JSON.stringify(s0);
  applyRule(spec, s0, selectRule(spec, s0, { verb: 'take', target: 'o1' }), { verb: 'take', target: 'o1' });
  assert.equal(JSON.stringify(s0), snapshot);
});
