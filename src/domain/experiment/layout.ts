import { Graph, layout } from "@dagrejs/dagre";
import type { Canvas } from "./canvas";

export interface Size {
  width: number;
  height: number;
}

export const structureKey = ({ nodes, edges }: Canvas) =>
  [...nodes.map(({ id }) => id).sort(), ...edges.map(({ source, target }) => `${source}>${target}`).sort()].join(" ");

export function arrange(canvas: Canvas, size: (id: string) => Size): Canvas {
  const graph = new Graph();
  graph.setGraph({ rankdir: "LR", ranksep: 72, nodesep: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of canvas.nodes) graph.setNode(node.id, { ...size(node.id) });
  for (const edge of canvas.edges) graph.setEdge(edge.source, edge.target);
  layout(graph);
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      const { x, y, width, height } = graph.node(node.id);
      return { ...node, position: { x: Math.round(x - width / 2), y: Math.round(y - height / 2) } };
    }),
  };
}
