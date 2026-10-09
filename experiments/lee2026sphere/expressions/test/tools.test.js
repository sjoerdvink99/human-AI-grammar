import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_LIBRARY } from '../server/sceneLibrary.js';
import { DEFAULT_PREFERENCE_MEMORY, DEFAULT_RETRIEVAL_POLICY } from '../server/store.js';
import { matchCandidates } from '../server/process1.js';
import { sampleScenes, selectAffordances, computeRewards, trainPolicy, makeRng } from '../server/policy.js';
import { generateRoomConstraints, composeGenerationConstraints, generateSceneGraph, mentionedCategories } from '../server/generator.js';
import { sceneFromGraph, executeSubtasks } from '../server/scene.js';
import { validateSubtasks, composeInteractionState } from '../server/process2.js';
import { extractObjectFeatures, assignZones, extractGeometricContext, affordancesToConstraints } from '../server/analysis.js';
import { updatePreferenceMemory, composeSessionPayload } from '../server/process3.js';
import { tagsToVector, overlapArea } from '../server/catalog.js';

function buildScene(sceneId, request = 'a living room') {
  const scene0 = SCENE_LIBRARY.find((s) => s.id === sceneId);
  const affs = scene0.affordances.map((a) => ({ ...a, total: 0.8 }));
  const rc = generateRoomConstraints(request, [scene0], affs);
  const gen = composeGenerationConstraints(rc, affs);
  const graph = generateSceneGraph(gen, 'seed');
  return { scene: sceneFromGraph(graph), graph, rc, affs };
}

test('tool_3 match ranks scenes by embedding similarity', () => {
  const q = tagsToVector(['bedroom', 'sleep', 'cozy']);
  const c = matchCandidates(q, DEFAULT_PREFERENCE_MEMORY(), DEFAULT_RETRIEVAL_POLICY());
  assert.equal(c.length, 6);
  assert.equal(c[0].id, 'lib-bed-cozy');
});

test('tool_3 select samples without replacement and filters affordances', () => {
  const policy = DEFAULT_RETRIEVAL_POLICY();
  const cands = SCENE_LIBRARY.slice(0, 4);
  const rows = cands.map((c, i) => ({ scene_id: c.id, total: 1 - i * 0.2 }));
  const s = sampleScenes(rows, cands, policy, makeRng('x'));
  assert.equal(s.length, 2);
  assert.notEqual(s[0].id, s[1].id);
  const sel = selectAffordances([{ key: 'a', total: 0.9 }, { key: 'a', total: 0.5 }, { key: 'b', total: 0.1 }]);
  assert.deepEqual(sel.map((x) => x.key), ['a']);
});

test('request parsing finds wanted and excluded objects and room size', () => {
  const m = mentionedCategories('A 4x5 living room with a piano, no tv');
  assert.ok(m.wanted.includes('piano'));
  assert.ok(m.unwanted.includes('tv_stand'));
  const lib = SCENE_LIBRARY.find((s) => s.id === 'lib-living-tv');
  const rc = generateRoomConstraints('A 4x5 living room with a piano, no tv', [lib], []);
  assert.equal(rc.width, 4); assert.equal(rc.depth, 5);
  assert.ok(rc.objects.some((o) => o.category === 'piano'));
  assert.ok(!rc.objects.some((o) => o.category === 'tv_stand'));
});

test('tool_1 generate produces a mostly collision-free layout that satisfies key constraints', () => {
  const { scene, graph } = buildScene('lib-living-tv');
  const solid = scene.objects.filter((o) => !o.floor);
  let overlap = 0;
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) overlap += overlapArea(solid[i], solid[j]);
  assert.ok(overlap < 0.2, `overlap ${overlap}`);
  const satisfied = graph.edges.filter((e) => e.satisfied).length / graph.edges.length;
  assert.ok(satisfied > 0.6, `satisfied ${satisfied}`);
});

test('dining chairs surround the table', () => {
  const { graph } = buildScene('lib-dining-family', 'dining room for 6');
  const around = graph.edges.filter((e) => e.type === 'around');
  assert.equal(around.length, 6);
  assert.ok(around.filter((e) => e.satisfied).length >= 4);
});

test('tool_2 execute applies and validates subtasks', () => {
  const { scene } = buildScene('lib-living-tv');
  const { valid, rejected } = validateSubtasks(scene, [{ op: 'move', object_id: 'sofa_1', x: 2, y: 2 }, { op: 'remove', object_id: 'ghost_1' }, { op: 'add', category: 'piano', x: 1, y: 1 }]);
  assert.equal(valid.length, 2); assert.equal(rejected.length, 1);
  const { scene: s2, report } = executeSubtasks(scene, valid);
  assert.ok(report.every((r) => r.ok));
  assert.ok(s2.objects.some((o) => o.category === 'piano'));
  assert.equal(scene.objects.some((o) => o.category === 'piano'), false, 'original scene untouched');
  const st = composeInteractionState(scene, { object_ids: ['sofa_1'], point: { x: 1, y: 1 } }, ' move this there ');
  assert.equal(st.targets[0].id, 'sofa_1'); assert.equal(st.transcript, 'move this there');
});

test('process 3 tools: features, zones, geometry, constraints, memory, rewards, training', () => {
  const { scene, rc, affs } = buildScene('lib-living-tv');
  const session = {
    id: 't1', scene,
    interaction_log: { events: [{ type: 'edit', report: [{ ok: true, subtask: { op: 'remove', object_id: 'plant_1' }, message: 'removed plant_1' }] }] },
    retrieval_trace: { request: 'tv room', query_embedding: tagsToVector(['living_room', 'watch_tv']), sampled_affordances: affs, sampled_scenes: [{ id: 'lib-living-tv' }], scored_scenes: [{ scene_id: 'lib-living-tv', sim: 1, llm_score: 1, pref: 0.5 }], room_constraints: rc },
  };
  session.scene = { ...scene, objects: scene.objects.filter((o) => o.id !== 'plant_1') };
  const payload = composeSessionPayload(session);
  const feats = extractObjectFeatures(payload);
  assert.ok(feats.some((f) => f.id === 'plant_1' && f.status === 'removed'));
  const zones = assignZones(feats);
  assert.ok(zones.nodes.length >= 2);
  const geo = extractGeometricContext(payload, zones);
  assert.ok(geo.edges.length > 0);
  const cons = affordancesToConstraints(['The sofa faces the tv_stand', 'The coffee table is near the sofa', 'Something vague'], payload, geo);
  assert.equal(cons[0].type, 'facing'); assert.equal(cons[0].a, 'sofa'); assert.equal(cons[0].b, 'tv_stand');
  assert.equal(cons[1].type, 'near');
  assert.equal(cons[2].parsed, false);
  const m2 = updatePreferenceMemory(DEFAULT_PREFERENCE_MEMORY(), cons, feats, payload);
  assert.equal(m2.version, 2); assert.ok(m2.object_prefs.plant < 0); assert.equal(m2.user_scenes.length, 1);
  const rewards = computeRewards([{ key: affs[0].key, signal: 'realized' }, { key: affs[1].key, signal: 'violated' }], session.retrieval_trace);
  assert.equal(rewards[0].reward, 1); assert.equal(rewards[1].reward, -1);
  const p2 = trainPolicy(rewards, DEFAULT_RETRIEVAL_POLICY(), session.retrieval_trace);
  assert.equal(p2.version, 2); assert.ok(p2.affordance_values[affs[0].key] > 0);
  // memory scenes become retrievable
  const c = matchCandidates(tagsToVector(['living_room', 'watch_tv']), m2, p2);
  assert.ok(c.some((s) => s.id === 'user-t1'));
});

test('generated layouts of every library scene have no furniture collisions', () => {
  for (const s of SCENE_LIBRARY) {
    for (const seed of ['a', 'b', 'c']) {
      const affs = s.affordances.map((a) => ({ ...a, total: 0.8 }));
      const gen = composeGenerationConstraints(generateRoomConstraints(s.name, [s], affs), affs);
      const scene = sceneFromGraph(generateSceneGraph(gen, seed));
      const solid = scene.objects.filter((o) => !o.floor);
      let overlap = 0;
      for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) overlap += overlapArea(solid[i], solid[j]);
      assert.ok(overlap < 0.05, `${s.id}/${seed}: overlap ${overlap.toFixed(2)}`);
    }
  }
});
