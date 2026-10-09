import { describe, expect, it } from 'vitest';
import { generateRoomConstraints, generateSceneGraph, parseRequestObjects } from '../server/tool1_scenegen';
import { composeGenerationConstraints, plackettLuceSample } from '../server/tool3_retrieval';
import { groundAffordances } from '../server/tool4_context';
import { initReranker, plackettLuceGradient, scoreKeys, softmax } from '../server/rerankers';
import { executeSubtasks } from '../shared/editOps';
import { overlapArea, isFloorCover, insideRoom } from '../shared/geometry';
import { computeRewards, trainPolicy } from '../server/tool5_optimizer';
import { initialPolicy } from '../server/store';
import { mulberry32 } from '../shared/rng';

describe('tool_1 scene generation', () => {
  it('parses objects, counts and exclusions', () => {
    const { mentioned, excluded } = parseRequestObjects('a living room with two armchairs, a coffee table and no tv');
    expect(mentioned.get('armchair')).toBe(2);
    expect(mentioned.get('coffee_table')).toBe(1);
    expect(mentioned.has('dining_table')).toBe(false);
    expect(excluded.has('tv_stand')).toBe(true);
  });
  it('produces a non-overlapping layout inside the room', () => {
    const rc = generateRoomConstraints('a bedroom with a desk', []);
    expect(rc.room.roomType).toBe('bedroom');
    expect(rc.objectTypes).toContain('desk');
    const g = generateSceneGraph(composeGenerationConstraints(rc, [], 42));
    expect(g.objects.length).toBe(rc.objectTypes.length);
    for (const o of g.objects) expect(insideRoom(o, g.room)).toBe(true);
    const solid = g.objects.filter((o) => !isFloorCover(o));
    let overlap = 0;
    for (const a of solid) for (const b of solid) if (a.id < b.id) overlap += overlapArea(a, b);
    expect(overlap).toBeLessThan(0.05);
  });
});

describe('tool_4 grounding', () => {
  it('accepts templated statements and rejects others', () => {
    const r = groundAffordances([
      'Place the floor lamp near the armchair because it lights reading.',
      'Place the desk near a window.',
      'Keep the bed away from the door.',
      'Orient the sofa to face the tv stand.',
      'The room should feel calm.',
    ]);
    expect(r.constraints.map((c) => c.kind)).toEqual(['near', 'near_window', 'away_from_door', 'facing']);
    expect(r.constraints[0]).toMatchObject({ subject: 'floor_lamp', object: 'armchair' });
    expect(r.constraints[3]).toMatchObject({ subject: 'sofa', object: 'tv_stand' });
    expect(r.rejected).toEqual(['The room should feel calm.']);
  });
});

describe('model_4/5 rerankers and tool_5', () => {
  it('Plackett–Luce gradient matches finite differences', () => {
    const rnd = mulberry32(1);
    const dim = 8;
    const r = initReranker(dim, 2, 3);
    r.B = r.B.map((row) => row.map(() => (rnd() - 0.5) * 0.2));
    const q = Array.from({ length: dim }, () => rnd() - 0.5);
    const keys = Array.from({ length: 4 }, () => Array.from({ length: dim }, () => rnd() - 0.5));
    const chosen = [2, 0];
    const logp = (rr: typeof r) => {
      const l = scoreKeys(rr, q, keys);
      let rem = [0, 1, 2, 3], s = 0;
      for (const c of chosen) { const p = softmax(rem.map((i) => l[i]), 1); s += Math.log(p[rem.indexOf(c)]); rem = rem.filter((i) => i !== c); }
      return s;
    };
    const g = plackettLuceGradient(r, q, keys, chosen, [1, 1], 1);
    const eps = 1e-5;
    const rp = structuredClone(r); rp.A[3][1] += eps;
    const rm = structuredClone(r); rm.A[3][1] -= eps;
    expect(g.gA[3][1]).toBeCloseTo((logp(rp) - logp(rm)) / (2 * eps), 4);
    const bp = structuredClone(r); bp.B[5][0] += eps;
    const bm = structuredClone(r); bm.B[5][0] -= eps;
    expect(g.gB[5][0]).toBeCloseTo((logp(bp) - logp(bm)) / (2 * eps), 4);
  });
  it('sampling returns k distinct indices', () => {
    const idx = plackettLuceSample([1, 2, 3, 4, 5], 3, 1, mulberry32(9));
    expect(new Set(idx).size).toBe(3);
  });
  it('a realized preference becomes more likely after training', () => {
    const policy = initialPolicy();
    const rnd = mulberry32(5);
    const vec = () => { const v = Array.from({ length: 384 }, () => rnd() - 0.5); const n = Math.hypot(...v); return v.map((x) => x / n); };
    const q = vec();
    const cands = [0, 1, 2].map((i) => ({ id: `a${i}`, key: vec(), statement: `s${i}`, sceneId: 'sc' }));
    const trace = { sessionId: 'x', request: 'r', policyVersion: 1, memoryVersion: 1, queryEmbedding: q,
      scenes: { candidates: [{ id: 'sc', key: vec() }], chosen: ['sc'] },
      affordances: { query: q, candidates: cands, chosen: ['a0', 'a1'] } };
    const before = softmax(scoreKeys(policy.affordanceReranker, q, cands.map((c) => c.key)), 1)[0];
    let p = policy;
    for (let i = 0; i < 5; i++) {
      const rewards = computeRewards([{ affordanceId: 'a0', signal: 'realized' }, { affordanceId: 'a1', signal: 'not_realized' }], trace);
      p = trainPolicy(p, trace, rewards).policy;
    }
    const after = softmax(scoreKeys(p.affordanceReranker, q, cands.map((c) => c.key)), 1)[0];
    expect(after).toBeGreaterThan(before);
    expect(p.version).toBe(6);
  });
});

describe('tool_2 execute', () => {
  it('applies and validates edit subtasks', () => {
    const rc = generateRoomConstraints('a small office', []);
    const g = generateSceneGraph(composeGenerationConstraints(rc, [], 1));
    const desk = g.objects.find((o) => o.type === 'desk')!;
    const { scene, results } = executeSubtasks(g, [
      { op: 'move', id: desk.id, x: 1, z: 1 },
      { op: 'recolor', id: desk.id, color: 'red' },
      { op: 'add', type: 'plant', near: desk.id },
      { op: 'remove', id: 'nonexistent_9' },
    ]);
    expect(scene.objects.find((o) => o.id === desk.id)!.color).toBe('#c0392b');
    expect(scene.objects.filter((o) => o.type === 'plant').length).toBe(g.objects.filter((o) => o.type === 'plant').length + 1);
    expect(results[3]).toMatch(/^✗/);
  });
});
