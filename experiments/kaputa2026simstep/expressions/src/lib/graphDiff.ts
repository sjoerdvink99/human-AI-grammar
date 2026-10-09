// tool_1 modify (process 5): deterministic application of approved UI-graph changes.
import type { Graph, GraphChanges } from "../../shared/types";

export function applyGraphChanges(graph: Graph, changes: GraphChanges, note: string): Graph {
  const removed = new Set(changes.remove_node_ids);
  // Clear notes from the previous round so only this round's changes are flagged.
  let nodes = graph.nodes.filter((n) => !removed.has(n.id)).map((n) => ({ ...n, change_note: undefined as string | undefined }));
  for (const u of changes.update_nodes) {
    nodes = nodes.map((n) =>
      n.id === u.id
        ? {
            ...n,
            ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined && v !== "")),
            id: n.id,
            change_note: note,
          }
        : n,
    );
  }
  const existing = new Set(nodes.map((n) => n.id));
  for (const a of changes.add_nodes) {
    if (!existing.has(a.id)) {
      nodes.push({ ...a, change_note: `added: ${note}` });
      existing.add(a.id);
    }
  }
  const rmEdge = (s: string, t: string) => changes.remove_edges.some((r) => r.source === s && r.target === t);
  const edges = [
    ...graph.edges.filter((e) => existing.has(e.source) && existing.has(e.target) && !rmEdge(e.source, e.target)),
    ...changes.add_edges.filter((e) => existing.has(e.source) && existing.has(e.target)),
  ];
  return { nodes, edges };
}

/** Keep only the parts of a suggested change the human approved. */
export function isEmptyChanges(c?: GraphChanges) {
  return !c || (!c.add_nodes.length && !c.update_nodes.length && !c.remove_node_ids.length && !c.add_edges.length && !c.remove_edges.length);
}
