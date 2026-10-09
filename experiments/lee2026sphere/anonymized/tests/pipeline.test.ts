import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MOCK_MODEL = '1';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'systemx-test-'));

const { seedLibrary, seedReliability } = await import('../server/library.ts');
const p1 = await import('../server/process1.ts');
const p2 = await import('../server/process2.ts');
const p3 = await import('../server/process3.ts');
const eng = await import('../server/sceneEngine.ts');
const { extractJson } = await import('../server/llm.ts');

const emit = { step: async <T,>(_r: string, _t: string, fn: () => Promise<T>) => fn() };

test('extractJson handles fenced and prefixed output', () => {
  assert.deepEqual(extractJson('Sure:\n```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
  assert.deepEqual(extractJson('x {"b":"}"} y'), { b: '}' });
});

test('tool_3 match retrieves by cosine similarity', () => {
  const lib = seedLibrary();
  const q = lib.assets.find((a) => a.id === 'bookshelf')!.vector;
  const r5 = p1.retrieve(q, lib, 5);
  assert.equal(r5[0].assetId, 'bookshelf');
  assert.ok(r5.length >= 5);
});

test('tool_3 select prefers reliable assets', () => {
  const rel = { ...seedReliability(), weights: { a: 0.1, b: 0.95 } };
  const chosen = p1.chooseAssets([{ slot: 's', assetId: 'a', count: 1, confidence: 0.8 }, { slot: 's', assetId: 'b', count: 1, confidence: 0.7 }], rel);
  assert.equal(chosen[0].assetId, 'b');
});

test('process 1 → 2 → 3 end to end (mock model)', async () => {
  const lib = seedLibrary();
  const rel = seedReliability();
  const { scene, layout, view } = await p1.runProcess1('a reading corner with an armchair next to a floor lamp', lib, rel, emit);
  assert.ok(layout.length > 0);
  for (const o of layout) {
    assert.ok(o.x >= 0 && o.x <= scene.room.width && o.y >= 0 && o.y <= scene.room.depth, `${o.id} inside room`);
  }
  const target = layout[0];
  const r2 = await p2.runProcess2({ transcript: 'move this right', selection: { objectIds: [target.id] }, scene, layout, view }, emit);
  assert.equal(r2.view.editLog.length, 1);

  // Force a learnable group: two touching objects.
  const grouped = [
    { ...layout[0], id: 'o1', assetId: 'armchair', name: 'Armchair', x: 200, y: 200, w: 85, h: 85, rot: 0 },
    { ...layout[0], id: 'o2', assetId: 'floor_lamp', name: 'Floor lamp', x: 270, y: 200, w: 35, h: 35, rot: 0 },
  ];
  const g = p3.extractGroups(p3.assignRelations(p3.objectTable(p3.snapshotScene(scene, grouped, view))));
  assert.equal(g.nodes.filter((n) => n.id.startsWith('group_')).length, 1);
  const r3 = await p3.runProcess3({ scene, layout: r2.layout, view: r2.view }, lib, rel, emit);
  assert.ok(r3.reliability.version >= rel.version);
});

test('tool_4 translate + compose build a composite asset that tool_2 can place', () => {
  const lib = seedLibrary();
  const scene = { id: 's', title: 't', request: 'r', room: { width: 500, depth: 400 }, createdAt: '' };
  const rows = [
    { id: 'o1', assetId: 'desk', name: 'Desk', x: 150, y: 35, w: 140, h: 70, rot: 0, color: '#777' },
    { id: 'o2', assetId: 'office_chair', name: 'Office chair', x: 150, y: 110, w: 60, h: 60, rot: 180, color: '#444' },
  ];
  const g = p3.extractGroups(p3.assignRelations(rows));
  (g.nodes.find((n) => n.id === 'group_1')!).data = { coherent: true, name: 'Work spot' };
  const recs = p3.toAssetRecords([{ groupId: 'group_1', text: 'Work spot — a desk with a chair' }], g, lib, scene);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].composite!.members.length, 2);
  const { library } = p3.mergeLibrary(lib, recs);
  const { placementRequest, scene: s2 } = eng.generatePlacementRequest([{ slot: 'work', assetId: recs[0].id, count: 1, score: 1 }], library, 'work spot');
  const graph = eng.generateSceneGraph(eng.composeLayoutSpec('work spot', placementRequest, [], s2));
  const { layout } = eng.graphToLayout(graph, library);
  assert.deepEqual(layout.map((o) => o.assetId).sort(), ['desk', 'office_chair']);
  // duplicate composite is not added twice
  assert.equal(p3.mergeLibrary(library, recs).added.length, 0);
});

test('tool_5 train moves reliability toward the score', () => {
  const r = p3.trainReliability(seedReliability(), [{ assetId: 'x', score: 1 }], 's');
  assert.ok(r.weights.x > 0.6);
});

test('model_2 op validation rejects unknown targets and bad colors', () => {
  const ids = new Set(['a']);
  assert.throws(() => p2.validateOp({ op: 'move', target: 'z', dx: 1 }, ids));
  assert.throws(() => p2.validateOp({ op: 'recolor', target: 'a', color: 'red' }, ids));
  assert.deepEqual(p2.validateOp({ op: 'rotate', target: 'a', degrees: '90' }, ids), { op: 'rotate', target: 'a', degrees: 90 });
});

test('tool_3 select drops members already contained in a chosen composite', () => {
  const rel = seedReliability();
  const chosen = p1.chooseAssets(
    [{ slot: 'nook', assetId: 'combo', count: 1, confidence: 0.9 }, { slot: 'seat', assetId: 'armchair', count: 2, confidence: 0.9 }, { slot: 'tv', assetId: 'tv_stand', count: 1, confidence: 0.9 }],
    rel,
    [{ assetId: 'combo', similarity: 1, relevance: 9, members: ['armchair', 'floor_lamp'] }],
  );
  assert.deepEqual(chosen.map((c) => [c.assetId, c.count]), [['combo', 1], ['armchair', 1], ['tv_stand', 1]]);
});
