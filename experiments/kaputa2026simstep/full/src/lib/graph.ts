import type { Graph, GraphOp } from '../../shared/types';

/** P5 [tool_1 modify]: apply an approved_change's operations to ui_graph (deterministic). */
export function applyGraphOps(graph: Graph, ops: GraphOp[]): { graph: Graph; warnings: string[] } {
  const g: Graph = { nodes: graph.nodes.map((n) => ({ ...n })), edges: graph.edges.map((e) => ({ ...e })) };
  const warnings: string[] = [];
  const has = (id?: string) => !!id && g.nodes.some((n) => n.id === id);
  for (const o of ops) {
    switch (o.op) {
      case 'add_node':
        if (!o.id) warnings.push('add_node without id skipped');
        else if (has(o.id)) warnings.push(`node ${o.id} already exists`);
        else g.nodes.push({ id: o.id, label: o.label || o.id, type: o.type || 'display', description: o.description || '' });
        break;
      case 'remove_node':
        if (!has(o.id)) warnings.push(`remove_node: ${o.id} not found`);
        g.nodes = g.nodes.filter((n) => n.id !== o.id);
        g.edges = g.edges.filter((e) => e.source !== o.id && e.target !== o.id);
        break;
      case 'update_node': {
        const n = g.nodes.find((x) => x.id === o.id);
        if (!n) warnings.push(`update_node: ${o.id} not found`);
        else {
          if (o.label) n.label = o.label;
          if (o.type) n.type = o.type;
          if (o.description) n.description = o.description;
        }
        break;
      }
      case 'add_edge':
        if (!has(o.source) || !has(o.target)) warnings.push(`add_edge ${o.source}→${o.target}: unknown node`);
        else g.edges.push({ id: o.id && !g.edges.some((e) => e.id === o.id) ? o.id : uid('e'), source: o.source!, target: o.target!, label: o.label || '' });
        break;
      case 'remove_edge': {
        const before = g.edges.length;
        g.edges = g.edges.filter((e) => e.id !== o.id && !(o.source && o.target && e.source === o.source && e.target === o.target));
        if (g.edges.length === before) warnings.push(`remove_edge: ${o.id} not found`);
        break;
      }
    }
  }
  return { graph: g, warnings };
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Layered layout: longest-path layers from sources, cycles broken by visit order. */
export function layoutGraph(g: Graph): Record<string, { x: number; y: number }> {
  const layer: Record<string, number> = {};
  const incoming = new Map<string, string[]>();
  g.nodes.forEach((n) => incoming.set(n.id, []));
  g.edges.forEach((e) => incoming.get(e.target)?.push(e.source));
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (layer[id] !== undefined) return layer[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id) ?? [];
    const d = preds.length ? Math.max(...preds.map(depth)) + 1 : 0;
    visiting.delete(id);
    return (layer[id] = d);
  };
  g.nodes.forEach((n) => depth(n.id));
  const byLayer: Record<number, string[]> = {};
  g.nodes.forEach((n) => (byLayer[layer[n.id]] ??= []).push(n.id));
  const pos: Record<string, { x: number; y: number }> = {};
  const PER_ROW = 4;
  let row = 0;
  Object.keys(byLayer).map(Number).sort((a, b) => a - b).forEach((l) => {
    const ids = byLayer[l];
    for (let start = 0; start < ids.length; start += PER_ROW, row++) {
      const chunk = ids.slice(start, start + PER_ROW);
      // stagger wrapped rows so links between them stay visible
      const offset = start > 0 ? 90 : 0;
      chunk.forEach((id, i) => (pos[id] = { x: i * 190 - ((chunk.length - 1) * 190) / 2 + offset, y: row * 110 }));
    }
  });
  return pos;
}
