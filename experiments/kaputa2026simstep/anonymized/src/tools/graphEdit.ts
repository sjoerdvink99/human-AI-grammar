// tool_1 modify (process 5): apply a chosen graph edit (r29) to the component graph r11_1 → r11_2.
import type { Graph, GraphEdit } from '../shared/types';

export function applyGraphEdit(g: Graph, edit: GraphEdit): Graph {
  const removed = new Set(edit.removeNodeIds);
  const updates = new Map(edit.updateNodes.map((n) => [n.id, n]));
  const nodes = g.nodes
    .filter((n) => !removed.has(n.id))
    .map((n) => (updates.has(n.id) ? { ...n, ...updates.get(n.id)! } : n))
    .concat(edit.addNodes.filter((n) => !g.nodes.some((m) => m.id === n.id)));
  const ids = new Set(nodes.map((n) => n.id));
  const rm = new Set(edit.removeEdges.map((e) => `${e.source}->${e.target}`));
  const edges = g.edges
    .filter((e) => !rm.has(`${e.source}->${e.target}`))
    .concat(edit.addEdges)
    .filter((e, i, arr) => ids.has(e.source) && ids.has(e.target) && arr.findIndex((x) => x.source === e.source && x.target === e.target) === i);
  return { nodes, edges };
}

/** Diff summary used to show what a graph edit changed. */
export function diffGraphs(a: Graph, b: Graph) {
  const aIds = new Set(a.nodes.map((n) => n.id));
  const bIds = new Set(b.nodes.map((n) => n.id));
  return {
    added: b.nodes.filter((n) => !aIds.has(n.id)).map((n) => n.id),
    removed: a.nodes.filter((n) => !bIds.has(n.id)).map((n) => n.id),
    changed: b.nodes
      .filter((n) => {
        const o = a.nodes.find((m) => m.id === n.id);
        return o && (o.label !== n.label || o.description !== n.description || o.kind !== n.kind);
      })
      .map((n) => n.id),
  };
}
