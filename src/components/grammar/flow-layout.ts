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
  boxes: FlowBox[];
  strokes: FlowStroke[];
}

export const boxWidth = 148;
export const boxHeight = 48;

const columnGap = 36;
const rowGap = 12;
const loopRoom = 20;
const sweeps = 4;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function layoutFlow({ stages, links }: Flow): FlowLayout {
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
  const stackHeight = (count: number) => count * boxHeight + (count - 1) * rowGap;
  const tallest = Math.max(...columns.map((column) => stackHeight(column.length)));
  const boxes = columns.flatMap((column, stage) =>
    column.map((index, row) => ({
      index,
      x: 1 + stage * (boxWidth + columnGap),
      y: top + (tallest - stackHeight(column.length)) / 2 + row * (boxHeight + rowGap),
    })),
  );
  const box = (index: number) => boxes.find((item) => item.index === index)!;

  const strokes = links.map(({ from, to, back }) => {
    const [a, b] = [box(from), box(to)];
    if (back) {
      const [ax, bx] = [a.x + boxWidth / 2, b.x + boxWidth / 2];
      const lift = top - loopRoom;
      return { key: `${from}<${to}`, from, to, back, path: `M${ax},${a.y} C${ax},${lift} ${bx},${lift} ${bx},${b.y - 2}` };
    }
    const [x1, y1, x2, y2] = [a.x + boxWidth, a.y + boxHeight / 2, b.x - 2, b.y + boxHeight / 2];
    const mid = (x1 + x2) / 2;
    return { key: `${from}>${to}`, from, to, back, path: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}` };
  });

  return {
    width: columns.length * boxWidth + (columns.length - 1) * columnGap + 2,
    height: top + tallest + 1,
    boxes,
    strokes,
  };
}
