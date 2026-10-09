import { formatTransform } from "../grammar/formatter";
import { loops } from "../grammar/features";
import type { Process, Representation, Transform } from "../grammar/types";

export interface GraphNode {
  key: string;
  representation: Representation;
  layer: number;
  /** A copy of a representation carried over unchanged, placed next to a later step that reads it. */
  carried?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  transform: Transform;
  back?: boolean;
}

export interface ProcessGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const sameEdge = (a: GraphEdge, b: GraphEdge) => a.from === b.from && a.to === b.to && formatTransform(a.transform) === formatTransform(b.transform);

export function processGraph(processes: Process[]): ProcessGraph {
  const representations = new Map<string, Representation>();
  const edges: GraphEdge[] = [];

  processes.forEach((process) => {
    for (const representation of process.states.flatMap((state) => state.representations)) {
      if (!representations.has(representation.id)) representations.set(representation.id, representation);
    }
    const seen = new Set(process.states[0].representations.map(({ id }) => id));
    const back = loops(process);
    process.transforms.forEach((transform, index) => {
      // A transformation reads what was just introduced and what it consumes. Representations that are carried past it
      // unchanged are context, not inputs, unless nothing else is left to read.
      const ids = (offset: number) => process.states[offset]?.representations.map(({ id }) => id) ?? [];
      const [before, current, after] = [ids(index - 1), ids(index), ids(index + 1)];
      const read = current.filter((id) => index === 0 || !before.includes(id) || !after.includes(id));
      const inputs = read.length ? read : current;
      const outputs = after.filter((id) => !seen.has(id));
      const returns = back.some(({ step }) => step === index) ? after : [];
      outputs.forEach((id) => seen.add(id));
      const forward = inputs.flatMap((from) => outputs.map((to) => ({ from, to, transform })));
      const backward = inputs.flatMap((from) => returns.map((to) => ({ from, to, transform, back: true })));
      for (const edge of [...forward, ...backward]) {
        if (!edges.some((existing) => sameEdge(existing, edge))) edges.push(edge);
      }
    });
  });

  const deepest = representations.size - 1;
  const layers = new Map([...representations.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < deepest; pass++) {
    for (const { from, to } of edges.filter((edge) => !edge.back)) layers.set(to, Math.max(layers.get(to)!, Math.min(layers.get(from)! + 1, deepest)));
  }

  // An input from further back is drawn as a carried copy right before the step that reads it, so every edge spans one layer.
  const nodes = new Map<string, GraphNode>([...representations].map(([id, representation]) => [id, { key: id, representation, layer: layers.get(id)! }]));
  const routed: GraphEdge[] = [];
  for (const edge of edges) {
    if (edge.back) {
      routed.push(edge);
      continue;
    }
    const layer = layers.get(edge.to)! - 1;
    const from = layer > layers.get(edge.from)! ? `${edge.from}@${layer}` : edge.from;
    if (!nodes.has(from)) nodes.set(from, { ...nodes.get(edge.from)!, key: from, layer, carried: true });
    const next = { ...edge, from };
    if (!routed.some((existing) => sameEdge(existing, next))) routed.push(next);
  }

  const used = [...new Set([...nodes.values()].map((node) => node.layer))].sort((x, y) => x - y);

  return {
    nodes: [...nodes.values()].map((node) => ({ ...node, layer: used.indexOf(node.layer) })),
    edges: routed,
  };
}

/** The processes, by label, that each representation appears in. */
export function representationPlaces(graphs: { place: string; graph: ProcessGraph }[]): Record<string, string[]> {
  const places: Record<string, string[]> = {};
  for (const { place, graph } of graphs) {
    for (const node of graph.nodes) {
      const found = (places[node.representation.id] ??= []);
      if (!found.includes(place)) found.push(place);
    }
  }
  return places;
}
