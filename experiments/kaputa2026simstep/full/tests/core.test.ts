import { describe, expect, it } from 'vitest';
import { applyGraphOps, layoutGraph } from '../src/lib/graph';
import { normalizeGraph } from '../server/ops';
import { runForErrors, runTests } from '../server/browser';

const g = { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ id: 'e1', source: 'a', target: 'b' }] };

describe('graph', () => {
  it('applies approved_change operations (tool_1 modify)', () => {
    const { graph, warnings } = applyGraphOps(g, [
      { op: 'add_node', id: 'c', label: 'C' },
      { op: 'add_edge', id: 'e2', source: 'b', target: 'c', label: 'drives' },
      { op: 'update_node', id: 'a', label: 'A2' },
      { op: 'remove_node', id: 'b' },
    ]);
    expect(warnings).toEqual([]);
    expect(graph.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(graph.nodes[0].label).toBe('A2');
    expect(graph.edges).toEqual([]);
  });
  it('normalizes model graphs: dangling links and duplicate ids removed', () => {
    const n = normalizeGraph({ nodes: [...g.nodes, { id: 'a', label: 'dup' }], edges: [...g.edges, { id: 'e1', source: 'a', target: 'zzz' }] });
    expect(n.nodes).toHaveLength(2);
    expect(n.edges).toHaveLength(1);
  });
  it('lays out nodes in layers', () => {
    const pos = layoutGraph(g);
    expect(pos.b.y).toBeGreaterThan(pos.a.y);
  });
});

const SIM = `<!DOCTYPE html><html><body>
<input id="mass" data-ui-node="mass" type="range" min="1" max="10" value="2">
<span id="out" data-ui-node="out">2</span><button id="boom" onclick="undefinedFn()">x</button>
<script>mass.addEventListener('input', () => out.textContent = mass.value * 2);</script></body></html>`;

describe('headless browser (tool_2)', () => {
  it('collects javascript errors and executes tests', async () => {
    const { javascript_errors } = await runForErrors('<html><body><script>nope()</script></body></html>');
    expect(javascript_errors.join()).toMatch(/nope/);
    const { test_results, test_screenshots } = await runTests(SIM, [
      { id: 't1', title: 'mass', purpose: '', expected: '', needs_human_check: false,
        steps: [{ action: 'set_value', selector: '#mass', value: '5' }, { action: 'read', selector: '#out' }] },
      { id: 't2', title: 'boom', purpose: '', expected: '', needs_human_check: false, steps: [{ action: 'click', selector: '#boom' }] },
    ]);
    expect(test_results[0].observations.join()).toMatch(/#out: 10/);
    expect(test_results[1].errors.join()).toMatch(/undefinedFn/);
    expect(test_screenshots[0].dataUrl).toMatch(/^data:image\/jpeg/);
  }, 30000);
});
