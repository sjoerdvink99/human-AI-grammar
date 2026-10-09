import { nodeKey, type ProcessGraph } from "@/domain/grammar/graph";
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
  /** The step drawn by this stroke; absent for the line that carries a representation over unchanged. */
  transform?: Transform;
  arrow?: boolean;
}

export interface Label {
  key: string;
  x: number;
  y: number;
  transform: Transform;
  loop?: boolean;
}

export interface Layout {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  strokes: Stroke[];
  labels: Label[];
  /** The states that loops return to, drawn as a band behind their column. */
  bands: Box[];
}

const nodeHeight = 28;
const rowGap = 14;
const minGap = 56;
/** From a column's right edge to the point where a step's inputs meet. */
const gatherRun = 28;
/** From the point where a multi-output step splits to the outputs. */
const branchRun = 28;
const labelPadding = 16;
const loopRise = 26;
const loopTurn = 20;
const corner = 8;
const bandPadding = 8;
const labelRoom = 12;

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
};

export function layoutGraph(graph: ProcessGraph, nodeWidth: (key: string) => number, labelWidth: (transform: Transform) => number): Layout {
  const { nodes, steps } = graph;
  const columnWidths = range(0, graph.columns).map((column) =>
    Math.max(40, ...nodes.filter((node) => node.column === column && !node.through).map((node) => nodeWidth(node.key))),
  );
  // The gap after a column holds the step that leaves it; a final loop only needs room to turn back.
  const gaps = range(0, graph.columns).map((column) => {
    const step = steps.find((candidate) => candidate.column === column);
    if (!step) return 0;
    if (step.back !== undefined) return Math.max(minGap, gatherRun + loopTurn + 4);
    return Math.max(minGap, gatherRun + labelWidth(step.transform) + labelPadding + (step.outputs.length > 1 ? branchRun : 0));
  });
  const lefts = range(0, graph.columns).map((column) => columnWidths.slice(0, column).reduce((sum, width, index) => sum + width + gaps[index], 1));
  const right = (column: number) => lefts[column] + columnWidths[column];

  // Nested loops rise higher than the loops they enclose.
  const loopSteps = steps.filter((step) => step.back !== undefined).sort((a, b) => a.column - a.back! - (b.column - b.back!));
  const levels = new Map(loopSteps.map((step, index) => [step, index + 1]));
  // Room above the first row for its step labels, and for the loops over the top.
  const top = loopSteps.length ? loopSteps.length * loopRise + 18 + bandPadding : labelRoom;
  const rowY = (row: number) => 1 + top + row * (nodeHeight + rowGap);
  const height = rowY(graph.rows) - rowGap + 1 + (loopSteps.length ? bandPadding : 0);
  const bands = new Map(
    [...new Set(loopSteps.map((step) => step.back!))].map((column) => [
      column,
      { x: lefts[column] - bandPadding, y: rowY(0) - bandPadding, width: columnWidths[column] + bandPadding * 2, height: rowY(graph.rows) - rowGap - rowY(0) + bandPadding * 2 },
    ]),
  );

  const boxes = new Map<string, Box>();
  for (const node of nodes) {
    // A lane passing through a column is a point at its centre, so the line carrying it stays straight.
    const width = node.through ? 0 : nodeWidth(node.key);
    boxes.set(node.key, { x: lefts[node.column] + (columnWidths[node.column] - width) / 2, y: rowY(node.row), width, height: nodeHeight });
  }
  const middle = (key: string) => boxes.get(key)!.y + nodeHeight / 2;

  const strokes: Stroke[] = [];
  const labels: Label[] = [];

  // A representation carried over unchanged stays in its row, joined to its previous column by a plain line.
  for (const node of nodes.filter((candidate) => candidate.carried)) {
    const from = boxes.get(nodeKey(node.representation.id, node.column - 1))!;
    const to = boxes.get(node.key)!;
    strokes.push({ key: `carry:${node.key}`, path: curve(from.x + from.width, from.y + nodeHeight / 2, to.x, to.y + nodeHeight / 2) });
  }

  steps.forEach((step, index) => {
    const { transform } = step;
    const outputs = step.outputs.map((key) => ({ key, x: boxes.get(key)!.x - 2, y: middle(key) }));
    const gather = {
      x: right(step.column) + gatherRun,
      y: outputs.length ? mean(outputs.map((output) => output.y)) : mean(step.inputs.map(middle)),
    };
    for (const input of step.inputs) {
      const box = boxes.get(input)!;
      strokes.push({ key: `in:${index}:${input}`, path: curve(box.x + box.width, middle(input), gather.x, gather.y), transform });
    }

    if (outputs.length) {
      const split = { x: Math.min(...outputs.map((output) => output.x)) - (outputs.length > 1 ? branchRun : 0), y: gather.y };
      strokes.push({
        key: `run:${index}`,
        path: `M${gather.x},${gather.y} L${split.x},${split.y}`,
        transform,
        arrow: outputs.length === 1 && outputs[0].y === gather.y && outputs[0].x === split.x,
      });
      for (const output of outputs) {
        if (outputs.length === 1 && output.y === gather.y && output.x === split.x) continue;
        strokes.push({ key: `out:${index}:${output.key}`, path: `${curve(split.x, split.y, output.x - 6, output.y)} L${output.x},${output.y}`, transform, arrow: true });
      }
      labels.push({ key: `step:${index}`, x: (gather.x + split.x) / 2, y: gather.y - 6, transform });
    }

    if (step.back !== undefined) {
      // One arc over the top, from where the step's inputs meet back to the state the step returns to.
      const level = levels.get(step)!;
      const peak = 1 + top - level * loopRise;
      const turn = gather.x + loopTurn;
      const land = bands.get(step.back)!.y - 1;
      const end = lefts[step.back] + columnWidths[step.back] / 2;
      const [start, turnX] = [gather, turn];
      strokes.push({
        key: `loop:${index}`,
        path: [
          `M${start.x},${start.y}`,
          `H${turnX - corner}`,
          `Q${turnX},${start.y} ${turnX},${start.y - corner}`,
          `V${peak + corner}`,
          `Q${turnX},${peak} ${turnX - corner},${peak}`,
          `H${end + corner}`,
          `Q${end},${peak} ${end},${peak + corner}`,
          `V${land}`,
        ].join(" "),
        transform,
        arrow: true,
      });
      labels.push({ key: `loop:${index}`, x: (turnX + end) / 2, y: peak - 5, transform, loop: true });
    }
  });

  const lastColumn = graph.columns - 1;
  return { width: right(lastColumn) + gaps[lastColumn] + 1, height, boxes, strokes, labels, bands: [...bands.values()] };
}
