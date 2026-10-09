import { formatTransform } from "../grammar/formatter";
import type { Process, Representation, Transform } from "../grammar/types";

export interface GraphNode {
  representation: Representation;
  layer: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  transform: Transform;
}

export interface ProcessGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const sameEdge = (a: GraphEdge, b: GraphEdge) => a.from === b.from && a.to === b.to && formatTransform(a.transform) === formatTransform(b.transform);

export function processGraph(processes: Process[]): ProcessGraph {
  const representations = new Map<string, Representation>();
  const edges: GraphEdge[] = [];

  for (const process of processes) {
    for (const representation of process.states.flatMap((state) => state.representations)) {
      if (!representations.has(representation.id)) representations.set(representation.id, representation);
    }
    process.transforms.forEach((transform, index) => {
      const inputs = process.states[index].representations.map(({ id }) => id);
      const outputs = process.states[index + 1].representations.map(({ id }) => id).filter((id) => !inputs.includes(id));
      for (const edge of inputs.flatMap((from) => outputs.map((to) => ({ from, to, transform })))) {
        if (!edges.some((existing) => sameEdge(existing, edge))) edges.push(edge);
      }
    });
  }

  const deepest = representations.size - 1;
  const layers = new Map([...representations.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < deepest; pass++) {
    for (const { from, to } of edges) layers.set(to, Math.max(layers.get(to)!, Math.min(layers.get(from)! + 1, deepest)));
  }

  return {
    nodes: [...representations.values()].map((representation) => ({ representation, layer: layers.get(representation.id)! })),
    edges,
  };
}
