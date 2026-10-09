import type { GraphEdge, ProcessGraph } from "@/domain/grammar/graph";
import type { Transform } from "@/domain/grammar/types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Stroke {
  key: string;
  path: string;
  transform?: Transform;
  arrow?: boolean;
}

export interface Label {
  key: string;
  x: number;
  y: number;
  transform: Transform;
}

export interface Layout {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  strokes: Stroke[];
  labels: Label[];
}

interface Slot {
  key: string;
  layer: number;
  width: number;
  height: number;
}

const nodeHeight = 28;
const slotGap = 16;
const minGap = 72;
const curveRun = 40;
const branchRun = 24;
const loopRise = 44;

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const baseName = (id: string) => /^(.*[^_])_[^_]+$/.exec(id)?.[1] ?? id;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
};

export function layoutGraph(graph: ProcessGraph, nodeWidth: (id: string) => number, tailLength: (edge: GraphEdge) => number): Layout {
  const layerOf = new Map(graph.nodes.map((node) => [node.key, node.layer]));
  const slots = new Map<string, Slot>(
    graph.nodes.map(({ key, layer }) => [key, { key, layer, width: nodeWidth(key), height: nodeHeight }]),
  );

  const edges = graph.edges.filter((edge) => !edge.back);
  const loops = graph.edges.filter((edge) => edge.back);
  const chains = edges.map((edge) => {
    const lanes = range(layerOf.get(edge.from)! + 1, layerOf.get(edge.to)!).map((layer) => {
      const key = `${edge.from}>${layer}`;
      if (!slots.has(key)) slots.set(key, { key, layer, width: 0, height: 0 });
      return key;
    });
    return [edge.from, ...lanes, edge.to];
  });

  const layerCount = Math.max(...graph.nodes.map((node) => node.layer)) + 1;
  const layers = range(0, layerCount).map((layer) => [...slots.values()].filter((slot) => slot.layer === layer).map((slot) => slot.key));
  const before = new Map<string, string[]>();
  for (const chain of chains) {
    chain.slice(1).forEach((key, index) => before.set(key, [...(before.get(key) ?? []), chain[index]]));
  }

  // A representation keeps the row it first appeared in, through carried copies and later versions; a new one sits
  // level with the inputs it was made from.
  const nameOf = new Map(graph.nodes.map((node) => [node.key, baseName(node.representation.id)]));
  const rows = new Map<string, number>();
  const ranks = new Map<string, number>();
  layers.forEach((keys, layer) => {
    keys.forEach((key, index) => {
      const name = nameOf.get(key);
      const inputs = (before.get(key) ?? []).map((other) => ranks.get(other)!);
      const rank = name !== undefined && rows.has(name) ? rows.get(name)! : inputs.length ? mean(inputs) : index;
      if (name !== undefined && !rows.has(name)) rows.set(name, rank);
      ranks.set(key, rank);
    });
    layers[layer] = [...keys].sort((a, b) => ranks.get(a)! - ranks.get(b)!);
  });

  const groups = new Map<Transform, GraphEdge[]>();
  for (const edge of edges) groups.set(edge.transform, [...(groups.get(edge.transform) ?? []), edge]);
  const outputs = (transform: Transform) => [...new Set(groups.get(transform)!.map((edge) => edge.to))];
  const lead = (edge: GraphEdge) => tailLength(edge) + (outputs(edge.transform).length > 1 ? branchRun : 0);

  const widths = layers.map((keys) => Math.max(...keys.map((key) => slots.get(key)!.width)));
  const gaps = range(0, layerCount).map((layer) =>
    Math.max(minGap, ...edges.filter((edge) => layerOf.get(edge.to) === layer + 1).map((edge) => lead(edge) + curveRun)),
  );
  const columns = range(0, layerCount).map((layer) => widths.slice(0, layer).reduce((sum, width, index) => sum + width + gaps[index], 1));
  const stackHeight = (keys: string[]) => keys.reduce((sum, key) => sum + slots.get(key)!.height, 0) + (keys.length - 1) * slotGap;
  const top = loops.length ? loopRise : 0;
  const height = Math.max(...layers.map(stackHeight)) + 2 + top;

  const boxes = new Map<string, Box>();
  layers.forEach((keys, layer) => {
    let y = 1 + top + (height - 2 - top - stackHeight(keys)) / 2;
    for (const key of keys) {
      const slot = slots.get(key)!;
      const width = slot.width || widths[layer];
      boxes.set(key, { x: columns[layer] + (widths[layer] - width) / 2, y, width, height: slot.height });
      y += slot.height + slotGap;
    }
  });

  const center = (key: string) => boxes.get(key)!.y + boxes.get(key)!.height / 2;
  const strokes = new Map<string, Stroke>();
  const labels: Label[] = [];

  for (const chain of chains) {
    chain.slice(1, -1).forEach((key, step) => {
      const [from, to] = [boxes.get(chain[step])!, boxes.get(key)!];
      strokes.set(`${chain[step]}|${key}`, {
        key: `${chain[step]}|${key}`,
        path: `${curve(from.x + from.width, center(chain[step]), to.x, center(key))} L${to.x + to.width},${center(key)}`,
      });
    });
  }

  [...groups].forEach(([transform, edges], group) => {
    const targets = outputs(transform);
    const ends = targets.map((id) => ({ id, x: boxes.get(id)!.x - 2, y: center(id), tail: tailLength(edges.find((edge) => edge.to === id)!) }));
    const junction = {
      x: Math.min(...ends.map((end) => end.x - end.tail)) - (targets.length > 1 ? branchRun : 0),
      y: targets.length > 1 ? mean(ends.map((end) => end.y)) : ends[0].y,
    };
    for (const edge of edges) {
      const chain = chains[edges.indexOf(edge)];
      const source = chain[chain.length - 2];
      const box = boxes.get(source)!;
      const key = `${source}>${group}`;
      strokes.set(key, { key, path: curve(box.x + box.width, center(source), junction.x, junction.y), transform });
    }
    for (const end of ends) {
      const key = `${group}>${end.id}`;
      const start = targets.length > 1 ? curve(junction.x, junction.y, end.x - end.tail, end.y) : `M${junction.x},${end.y}`;
      strokes.set(key, { key, path: `${start} L${end.x},${end.y}`, transform, arrow: true });
    }
    const top = ends.reduce((highest, end) => (end.y < highest.y ? end : highest));
    labels.push({ key: String(group), x: top.x - 8, y: top.y - 6, transform });
  });

  loops.forEach((edge, index) => {
    const [from, to] = [boxes.get(edge.from)!, boxes.get(edge.to)!];
    const [x1, x2] = [from.x + from.width / 2, to.x + to.width / 2];
    const key = `loop${index}`;
    strokes.set(key, { key, path: `M${x1},${from.y} C${x1},16 ${x2},16 ${x2},${to.y - 2}`, transform: edge.transform, arrow: true });
    if (!groups.has(edge.transform)) labels.push({ key, x: (x1 + x2) / 2 + tailLength(edge) / 2, y: 14, transform: edge.transform });
  });

  return { width: columns[layerCount - 1] + widths[layerCount - 1] + 1, height, boxes, strokes: [...strokes.values()], labels };
}
