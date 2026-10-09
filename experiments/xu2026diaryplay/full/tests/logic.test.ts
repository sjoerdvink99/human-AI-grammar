import { describe, expect, it } from 'vitest';
import { LAYOUTS, getLayout } from '../shared/layouts';
import { approachTiles, canPlace, findPath, placeObjects, startPositions, isWalkable } from '../shared/tool1';
import { applyRound, composeVignette, evaluateDeviation, initRuntime, selectNpcActivities, validatePlans } from '../shared/runtime';
import type { Character, GameObject, Project } from '../shared/types';

const obj = (id: string, roomId: string, w = 1, h = 1, againstWall = false): GameObject =>
  ({ id, name: id, roomId, w, h, againstWall, emoji: '📦', affordances: ['use'], pos: null });
const ch = (id: string, isPlayer: boolean): Character =>
  ({ id, name: id, isPlayer, description: '', personality: '', background: '', goals: '', speakingStyle: '', traits: [], color: '#000' });

describe('tool_1 placement and path-finding', () => {
  it('places objects without overlap and keeps all floor reachable', () => {
    const layout = getLayout('four-rooms')!;
    const objects = ['A', 'B', 'C', 'D'].flatMap((r) => [obj(`${r}1`, r, 3, 1, true), obj(`${r}2`, r, 2, 2), obj(`${r}3`, r)]);
    const env = placeObjects(layout, { A: 'a', B: 'b', C: 'c', D: 'd' }, objects);
    expect(env.objects.every((o) => o.pos)).toBe(true);
    for (const o of env.objects) expect(approachTiles(env, o).length).toBeGreaterThan(0);
    const s = startPositions(env, ['p', 'q']);
    for (const o of env.objects) expect(findPath(env, s.p, approachTiles(env, o))).not.toBeNull();
  });
  it('every layout template has connected rooms', () => {
    for (const l of LAYOUTS) {
      const env = placeObjects(l, {}, []);
      const a = { x: l.rooms[0].x, y: l.rooms[0].y };
      for (const r of l.rooms) expect(findPath(env, a, [{ x: r.x, y: r.y }]), l.id).not.toBeNull();
    }
  });
  it('rejects overlapping placement', () => {
    const env = placeObjects(getLayout('studio')!, {}, [obj('x', 'A', 2, 2)]);
    const y = obj('y', 'A');
    expect(canPlace(env, y, env.objects[0].pos!, env.objects)).toBe(false);
    expect(isWalkable(env, env.objects[0].pos!)).toBe(false);
  });
});

describe('tool_2 runtime', () => {
  const layout = getLayout('studio')!;
  const env = placeObjects(layout, { A: 'kitchen' }, [obj('stove', 'A', 2, 1, true), obj('table', 'A', 2, 2)]);
  const project: Project = {
    story: 's', characters: [ch('me', true), ch('gran', false)], layoutId: 'studio', layoutReason: '', roomLabels: { A: 'kitchen' },
    objects: env.objects, environment: env,
    activities: [
      { id: 'a1', characterId: 'gran', action: 'cooks', objectId: 'stove', description: '' },
      { id: 'a2', characterId: 'me', action: 'sets the table', objectId: 'table', description: '' },
      { id: 'a3', characterId: 'gran', action: 'serves', objectId: 'table', description: '' },
    ],
    events: [{ id: 'e2', order: 2, title: 'Dinner', activityIds: ['a3'] }, { id: 'e1', order: 1, title: 'Prep', activityIds: ['a1', 'a2'] }],
    vignetteId: null,
  };
  const { vignette: v, errors } = composeVignette(project, 'v1', 'T');
  it('composes a valid vignette in chronological order', () => {
    expect(errors).toEqual([]);
    expect(v!.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });
  it('reports composition errors', () => {
    expect(composeVignette({ ...project, characters: [ch('me', false)] }, 'x', 'x').errors.length).toBeGreaterThan(0);
  });
  it('evaluates deviation, enforces plans, and advances events', () => {
    let s = initRuntime(v!);
    expect(evaluateDeviation(v!, s, { kind: 'interact', objectId: 'stove', verb: 'use' })).toBe('diverges');
    expect(evaluateDeviation(v!, s, { kind: 'idle' })).toBe('diverges');
    const follow = { kind: 'interact' as const, objectId: 'table', verb: 'use' };
    expect(evaluateDeviation(v!, s, follow)).toBe('follows');
    // model tried to complete a key event in the diverge branch: validation must strip it
    const plans = validatePlans(v!, s, [{ characterId: 'gran', follow: { characterId: 'gran', action: 'naps', objectId: 'nope', activityId: null, say: '' }, diverge: { characterId: 'gran', action: 'cooks', objectId: 'stove', activityId: 'a1', say: 'hey' } }]);
    expect(plans[0].follow.activityId).toBe('a1');
    expect(plans[0].diverge.activityId).toBeNull();
    // diverging does not advance the story
    const s2 = applyRound(v!, s, { kind: 'idle' }, selectNpcActivities(plans, 'diverges'));
    expect(s2.eventIndex).toBe(0);
    s = applyRound(v!, s, follow, selectNpcActivities(plans, 'follows'));
    expect(s.eventIndex).toBe(1);
    const p2 = validatePlans(v!, s, []);
    s = applyRound(v!, s, { kind: 'wait' }, selectNpcActivities(p2, evaluateDeviation(v!, s, { kind: 'wait' })));
    expect(s.finished).toBe(true);
  });
});
