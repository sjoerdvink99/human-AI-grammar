import { describe, expect, it } from 'vitest';
import {
  applyParameterEdit,
  applyStructureEdit,
  extractSubtree,
  findNode,
  findParent,
  normalizeScene,
  parseScene,
  patchSubtree,
  SceneError,
  serializeScene,
  subtreeIds,
} from '../src/shared/scene';
import { composeGenerationInput, composeScopedInput } from '../server/compose';
import { extractJson } from '../server/model';

const raw = {
  title: 'Table',
  root: {
    id: 'table',
    name: 'Table',
    kind: 'group',
    children: [
      { id: 'top', name: 'Top', geometry: { shape: 'box', width: 2, height: 0.1, depth: 1 }, position: [0, 1, 0], color: '#a0522d' },
      {
        id: 'legs',
        name: 'Legs',
        kind: 'group',
        children: [
          { id: 'leg', name: 'Leg 1', geometry: { shape: 'cylinder', radiusTop: 0.05, radiusBottom: 0.05, height: 1 }, position: [0.9, 0.5, 0.4] },
          { id: 'leg', name: 'Leg 2', geometry: { shape: 'cylinder' }, position: [-0.9, 0.5, 0.4] },
        ],
      },
    ],
  },
};

describe('normalizeScene', () => {
  it('fills defaults and makes ids unique', () => {
    const s = normalizeScene(raw);
    expect(s.format).toBe('systemx-scene/1');
    const legs = findNode(s, 'legs')!;
    expect(legs.children.map((c) => c.id)).toEqual(['leg', 'leg_2']);
    expect(legs.children[1].geometry).toEqual({ shape: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 1 });
    expect(findNode(s, 'top')!.rotation).toEqual([0, 0, 0]);
    expect(parseScene(serializeScene(s))).toEqual(s);
  });
  it('rejects unknown shapes and bad dimensions', () => {
    expect(() => normalizeScene({ root: { name: 'x', geometry: { shape: 'teapot' } } })).toThrow(SceneError);
    expect(() => normalizeScene({ root: { name: 'x', geometry: { shape: 'box', width: -1 } } })).toThrow(SceneError);
  });
});

describe('selection and subtree', () => {
  const s = normalizeScene(raw);
  it('subtreeIds covers descendants', () => {
    expect([...subtreeIds(s, 'legs')].sort()).toEqual(['leg', 'leg_2', 'legs']);
  });
  it('patchSubtree replaces only that region and keeps the id', () => {
    const frag = { id: 'whatever', name: 'Legs', kind: 'group', children: [{ id: 'top', name: 'Pedestal', geometry: { shape: 'cylinder' } }] };
    const p = patchSubtree(s, 'legs', frag);
    expect(findNode(p, 'legs')!.children).toHaveLength(1);
    expect(findNode(p, 'legs')!.children[0].id).toBe('top_2'); // collision with the untouched top renamed
    expect(findNode(p, 'top')!.name).toBe('Top');
    expect(extractSubtree(s, 'legs').children).toHaveLength(2); // original untouched
  });
});

describe('edits', () => {
  const s = normalizeScene(raw);
  it('parameter edits', () => {
    let t = applyParameterEdit(s, { nodeId: 'top', field: 'position', axis: 1, value: 1.2 });
    t = applyParameterEdit(t, { nodeId: 'top', field: 'color', value: '#00ff00' });
    t = applyParameterEdit(t, { nodeId: 'top', field: 'dimension', key: 'width', value: 3 });
    const top = findNode(t, 'top')!;
    expect(top.position[1]).toBe(1.2);
    expect(top.color).toBe('#00ff00');
    expect(top.geometry).toMatchObject({ width: 3 });
    expect(findNode(s, 'top')!.position[1]).toBe(1);
  });
  it('structure edits', () => {
    const a = applyStructureEdit(s, { op: 'addPart', parentId: 'legs', shape: 'sphere' });
    expect(findParent(a.scene, a.focusId!)!.id).toBe('legs');
    const b = applyStructureEdit(a.scene, { op: 'reparent', nodeId: 'top', newParentId: 'legs', index: 0 });
    expect(findNode(b.scene, 'legs')!.children[0].id).toBe('top');
    const c = applyStructureEdit(b.scene, { op: 'outdent', nodeId: 'top' });
    expect(findParent(c.scene, 'top')!.id).toBe('table');
    const d = applyStructureEdit(c.scene, { op: 'wrapInGroup', nodeId: 'top' });
    expect(findNode(d.scene, d.focusId!)!.children[0].id).toBe('top');
    const e = applyStructureEdit(d.scene, { op: 'delete', nodeId: 'legs' });
    expect(findNode(e.scene, 'leg')).toBeNull();
    expect(() => applyStructureEdit(s, { op: 'reparent', nodeId: 'legs', newParentId: 'leg' })).toThrow();
    expect(() => applyStructureEdit(s, { op: 'delete', nodeId: 'table' })).toThrow();
  });
});

describe('compose + json extraction', () => {
  const s = normalizeScene(raw);
  it('includes current scene only for follow-up prompts', () => {
    expect(composeGenerationInput('a chair').user).not.toContain('CURRENT scene');
    expect(composeGenerationInput('a chair', s).user).toContain('"id": "legs"');
  });
  it('scoped input contains only the subtree', () => {
    const inp = composeScopedInput(s, 'legs', extractSubtree(s, 'legs'), 'make thicker');
    expect(inp.user).toContain('Table > Legs');
    expect(inp.user).not.toContain('"id": "top"');
  });
  it('extractJson tolerates fences', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
