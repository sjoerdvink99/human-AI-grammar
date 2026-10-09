import type { Flow } from "@/domain/systems/flow";

export interface FlowBox {
  index: number;
  x: number;
  y: number;
}

export interface FlowStroke {
  key: string;
  from: number;
  to: number;
  back: boolean;
  path: string;
}

export interface FlowLayout {
  width: number;
  height: number;
  boxHeight: number;
  boxes: FlowBox[];
  strokes: FlowStroke[];
}

export const boxWidth = 204;
export const boxHeight = 82;
export const columnGap = 40;

const rowGap = 16;
const loopRoom = 20;
const corner = 8;
const clearance = 7;
const margin = 14;
const sweeps = 4;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

type Point = [number, number];

// A right-angled path through the points, with rounded corners; collinear points are dropped.
export function orthogonal(points: Point[], radius = corner): string {
  const kept = points.filter((point, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const [prev, next] = [points[i - 1], points[i + 1]];
    return !((prev[0] === point[0] && point[0] === next[0]) || (prev[1] === point[1] && point[1] === next[1]));
  });
  let d = `M${kept[0][0]},${kept[0][1]}`;
  for (let i = 1; i < kept.length - 1; i++) {
    const [prev, point, next] = [kept[i - 1], kept[i], kept[i + 1]];
    const r = Math.min(radius, Math.hypot(point[0] - prev[0], point[1] - prev[1]) / 2, Math.hypot(next[0] - point[0], next[1] - point[1]) / 2);
    const toward = (from: Point, to: Point, by: number): Point => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
      return [from[0] + ((to[0] - from[0]) / length) * by, from[1] + ((to[1] - from[1]) / length) * by];
    };
    const [enter, leave] = [toward(point, prev, r), toward(point, next, r)];
    d += ` L${enter[0]},${enter[1]} Q${point[0]},${point[1]} ${leave[0]},${leave[1]}`;
  }
  const last = kept[kept.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

export function layoutFlow({ stages, links }: Flow, height = boxHeight): FlowLayout {
  const columns = stages.map((stage) => [...stage]);
  const forward = links.filter((link) => !link.back);
  const neighbors = (index: number, upstream: boolean) =>
    forward.filter((link) => (upstream ? link.to : link.from) === index).map((link) => (upstream ? link.from : link.to));

  const order = (column: number, upstream: boolean) => {
    const rank = new Map(columns.flat().map((index) => [index, columns.find((stage) => stage.includes(index))!.indexOf(index)]));
    const position = (index: number, fallback: number) => {
      const linked = neighbors(index, upstream).map((other) => rank.get(other)!);
      return linked.length ? mean(linked) : fallback;
    };
    columns[column] = columns[column]
      .map((index, fallback) => ({ index, rank: position(index, fallback) }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ index }) => index);
  };
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let column = 1; column < columns.length; column++) order(column, true);
    for (let column = columns.length - 2; column >= 0; column--) order(column, false);
  }

  const hasLoops = links.some((link) => link.back);
  const top = hasLoops ? loopRoom + 4 : 1;
  const stackHeight = (count: number) => count * height + (count - 1) * rowGap;
  const tallest = Math.max(...columns.map((column) => stackHeight(column.length)));
  const boxes = columns.flatMap((column, stage) =>
    column.map((index, row) => ({
      index,
      stage,
      x: 1 + stage * (boxWidth + columnGap),
      y: top + (tallest - stackHeight(column.length)) / 2 + row * (height + rowGap),
    })),
  );
  const box = (index: number) => boxes.find((item) => item.index === index)!;

  // A horizontal run across the stages between two boxes that touches none of their boxes, as close to both ends as possible.
  const channel = (from: number, to: number, y1: number, y2: number) => {
    const between = boxes.filter((item) => item.stage > from && item.stage < to);
    const candidates = [y1, y2, ...between.flatMap((item) => [item.y - rowGap / 2, item.y + height + rowGap / 2, item.y - margin, item.y + height + margin])];
    const clear = (y: number) => between.every((item) => y < item.y - clearance || y > item.y + height + clearance);
    return candidates.filter(clear).sort((a, b) => Math.abs(a - y1) + Math.abs(a - y2) - (Math.abs(b - y1) + Math.abs(b - y2)))[0];
  };

  const strokes = links.map(({ from, to, back }) => {
    const [a, b] = [box(from), box(to)];
    if (back) {
      const [ax, bx] = [a.x + boxWidth / 2, b.x + boxWidth / 2];
      const lift = top - loopRoom;
      return { key: `${from}<${to}`, from, to, back, path: orthogonal([[ax, a.y], [ax, lift], [bx, lift], [bx, b.y - 1.5]]) };
    }
    const [x1, y1, x2, y2] = [a.x + boxWidth, a.y + height / 2, b.x - 1.5, b.y + height / 2];
    const trunk = x1 + columnGap / 2;
    if (b.stage - a.stage === 1) return { key: `${from}>${to}`, from, to, back, path: orthogonal([[x1, y1], [trunk, y1], [trunk, y2], [x2, y2]]) };
    const y = channel(a.stage, b.stage, y1, y2);
    const entry = b.x - columnGap / 2;
    return {
      key: `${from}>${to}`,
      from,
      to,
      back,
      path: orthogonal([[x1, y1], [trunk, y1], [trunk, y], [entry, y], [entry, y2], [x2, y2]]),
    };
  });

  return {
    width: columns.length * boxWidth + (columns.length - 1) * columnGap + 2,
    height: top + tallest + 1,
    boxHeight: height,
    boxes: boxes.map(({ index, x, y }) => ({ index, x, y })),
    strokes,
  };
}
