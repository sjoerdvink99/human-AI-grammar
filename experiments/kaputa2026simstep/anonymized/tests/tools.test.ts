import { describe, expect, it } from 'vitest';
import { applyGraphEdit, diffGraphs } from '../src/tools/graphEdit';
import { subgraph, validateCode, validateDataSpec, validateGraph, validateGraphEdit } from '../src/shared/validate';
import { buildSrcdoc } from '../src/tools/sandbox';
import { OPS } from '../server/ops';
import type { Graph } from '../src/shared/types';

const g: Graph = {
  nodes: [
    { id: 'data', label: 'Data', kind: 'data', description: '' },
    { id: 'x', label: 'X scale', kind: 'scale', description: '' },
    { id: 'bars', label: 'Bars', kind: 'mark', description: '' },
  ],
  edges: [{ source: 'data', target: 'x' }, { source: 'x', target: 'bars' }],
};

describe('tool_1 modify: applyGraphEdit', () => {
  it('adds, updates and removes nodes and edges', () => {
    const g2 = applyGraphEdit(g, {
      addNodes: [{ id: 'labels', label: 'Labels', kind: 'label', description: 'value labels' }],
      updateNodes: [{ id: 'bars', label: 'Bars', kind: 'mark', description: 'rounded bars' }],
      removeNodeIds: ['x'],
      addEdges: [{ source: 'data', target: 'labels' }, { source: 'data', target: 'bars' }],
      removeEdges: [],
    });
    expect(g2.nodes.map((n) => n.id)).toEqual(['data', 'bars', 'labels']);
    expect(g2.edges).toEqual([{ source: 'data', target: 'labels' }, { source: 'data', target: 'bars' }]);
    expect(diffGraphs(g, g2)).toEqual({ added: ['labels'], removed: ['x'], changed: ['bars'] });
  });
});

describe('validators', () => {
  it('rejects dangling edges and duplicate ids', () => {
    expect(() => validateGraph({ nodes: g.nodes, edges: [{ source: 'data', target: 'nope' }] })).toThrow(/does not exist/);
    expect(() => validateGraph({ nodes: [...g.nodes, g.nodes[0]], edges: [] })).toThrow(/duplicate/);
  });
  it('builds subgraphs only from known ids', () => {
    expect(subgraph(g, ['data', 'x']).edges).toHaveLength(1);
    expect(() => subgraph(g, ['zzz'])).toThrow(/unknown/);
  });
  it('checks the program contract', () => {
    const ok = 'const SAMPLE_DATA=[1];\nfunction render(svg, data){ }';
    expect(validateCode('```js\n' + ok + '\n```')).toBe(ok);
    expect(() => validateCode('function render(svg){')).toThrow();
    expect(() => validateCode('function draw(){} const SAMPLE_DATA=[]')).toThrow(/render/);
    expect(() => validateCode("import x from 'd3'; const SAMPLE_DATA=[]; function render(){}")).toThrow(/import/);
  });
  it('checks data specs and graph edits', () => {
    expect(() => validateDataSpec({ fields: [{ name: 'a', type: 'number', description: '' }], sample: [{ a: 1 }, { a: 2 }, { b: 3 }] })).toThrow(/missing/);
    expect(() => validateGraphEdit({ addNodes: [], updateNodes: [], removeNodeIds: ['nope'], addEdges: [], removeEdges: [] }, g)).toThrow();
  });
});

describe('sandbox srcdoc', () => {
  it('escapes closing script tags and embeds data safely', () => {
    const doc = buildSrcdoc('const s = "</script>"; const SAMPLE_DATA=[]; function render(){}', [{ a: '</script>' }], 'r', true);
    expect(doc.match(/<\/script>/g)!.length).toBe(3);
  });
});

describe('ops', () => {
  it('has one op per model step of the design (24 model steps)', () => {
    expect(Object.keys(OPS)).toHaveLength(24);
    expect(OPS.intentGraph.prompt({ request: 'rain' })).toContain('rain');
  });
});
