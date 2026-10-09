import type { TreeNode } from "@/domain/analysis/process-tree";
import { formatTransform } from "@/domain/grammar/formatter";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A share of a node's processes: the ones that take a next step (node), or the ones that end there.
export interface Part {
  node?: TreeNode;
  count: number;
}

export type Box = Part & Rect;

export interface Tile extends Box {
  children: Box[];
}

export const headerHeight = 40;

const gap = 3;
const inner = 6;
const minBody = 20;

export const transformLabel = (node: TreeNode) => (node.transform ? formatTransform(node.transform) : "");

export function parts(node: TreeNode): Part[] {
  const ending = node.paths.length - node.children.reduce((sum, child) => sum + child.paths.length, 0);
  return [...node.children.map((child) => ({ node: child, count: child.paths.length })), { count: ending }]
    .filter((part) => part.count > 0)
    .sort((a, b) => b.count - a.count);
}

const inset = <T extends Rect>(rect: T, by: number): T => ({
  ...rect,
  x: rect.x + by,
  y: rect.y + by,
  width: Math.max(0, rect.width - 2 * by),
  height: Math.max(0, rect.height - 2 * by),
});

// Squarified treemap (Bruls et al., 2000); expects items sorted by count, largest first.
export function squarify<T extends Part>(items: T[], bounds: Rect): (T & Rect)[] {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const placed: (T & Rect)[] = [];
  if (total === 0 || bounds.width <= 0 || bounds.height <= 0) return placed;

  const scale = (bounds.width * bounds.height) / total;
  let { x, y, width, height } = bounds;
  let row: T[] = [];

  const worst = (candidate: T[], side: number) => {
    const areas = candidate.map((item) => item.count * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    return Math.max((side * side * Math.max(...areas)) / (sum * sum), (sum * sum) / (side * side * Math.min(...areas)));
  };

  const flush = () => {
    const vertical = width >= height;
    const thickness = row.reduce((sum, item) => sum + item.count * scale, 0) / (vertical ? height : width);
    let offset = 0;
    for (const item of row) {
      const length = (item.count * scale) / thickness;
      placed.push(
        vertical
          ? { ...item, x, y: y + offset, width: thickness, height: length }
          : { ...item, x: x + offset, y, width: length, height: thickness },
      );
      offset += length;
    }
    if (vertical) {
      x += thickness;
      width -= thickness;
    } else {
      y += thickness;
      height -= thickness;
    }
    row = [];
  };

  for (const item of items) {
    const side = Math.min(width, height);
    if (row.length > 0 && worst([...row, item], side) > worst(row, side)) flush();
    row.push(item);
  }
  if (row.length > 0) flush();
  return placed;
}

// One level of tiles for the focused node, each previewing its own next steps below its header.
export function layoutTreemap(focus: TreeNode, bounds: Rect): Tile[] {
  return squarify(parts(focus), bounds).map((box) => {
    const tile = inset(box, gap / 2);
    const body = {
      x: tile.x + inner,
      y: tile.y + headerHeight,
      width: tile.width - 2 * inner,
      height: tile.height - headerHeight - inner,
    };
    const children =
      box.node && body.width >= minBody && body.height >= minBody
        ? squarify(parts(box.node), body)
            .filter((part) => part.node)
            .map((part) => inset(part, 1))
        : [];
    return { ...tile, children };
  });
}
