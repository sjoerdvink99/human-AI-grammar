import { loops } from "../grammar/features";
import type { Process, Representation, Transform } from "../grammar/types";

/**
 * A process drawn the way it is written: one column per state, one transformation between neighbouring columns.
 * A representation keeps its row while it is carried over, so a step only ever connects adjacent columns.
 */
export interface GraphNode {
  key: string;
  representation: Representation;
  column: number;
  row: number;
  /** Carried over unchanged from the previous state. */
  carried?: boolean;
  /** Carried over and not read by the next step, so only its lane passes through this column. */
  through?: boolean;
}

export interface GraphStep {
  transform: Transform;
  /** The column of the state the step starts from. */
  column: number;
  /** Node keys in `column` that the step reads. */
  inputs: string[];
  /** Node keys in `column + 1` that the step produces; empty when the step closes a loop. */
  outputs: string[];
  /** The column of the earlier state the step returns to, when it closes a loop. */
  back?: number;
}

export interface ProcessGraph {
  nodes: GraphNode[];
  steps: GraphStep[];
  columns: number;
  rows: number;
}

export const nodeKey = (id: string, column: number) => `${id}@${column}`;

const baseName = (id: string) => /^(.*[^_])_[^_]+$/.exec(id)?.[1] ?? id;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function processGraph(process: Process): ProcessGraph {
  const ids = (index: number) => process.states[index]?.representations.map(({ id }) => id) ?? [];
  const returns = new Map(loops(process).map(({ step, to }) => [step, to]));
  const last = process.transforms.length - 1;
  // A final state that only repeats an earlier one is drawn as the loop back to it, not as another column.
  const columns = process.states.length - (returns.has(last) ? 1 : 0);

  // A step reads what was just introduced and what it consumes; representations carried past it unchanged are
  // context, unless nothing else is left to read.
  const reads = (index: number) => {
    const [before, current, after] = [ids(index - 1), ids(index), ids(index + 1)];
    const read = current.filter((id) => index === 0 || !before.includes(id) || !after.includes(id));
    return read.length ? read : current;
  };
  const produces = (index: number) => {
    const [current, after] = [ids(index), ids(index + 1)];
    const made = after.filter((id) => !current.includes(id));
    return made.length ? made : after;
  };

  const nodes: GraphNode[] = [];
  const rowOf = new Map<string, number>();
  for (let column = 0; column < columns; column++) {
    const previous = column > 0 ? ids(column - 1) : [];
    const taken = new Set<number>();
    const place = (id: string, row: number) => {
      taken.add(row);
      rowOf.set(id, row);
      return row;
    };
    const representations = process.states[column].representations;
    const rows = new Map<string, number>();
    for (const { id } of representations) if (previous.includes(id)) rows.set(id, place(id, rowOf.get(id)!));

    const sources = column > 0 ? reads(column - 1).map((id) => rowOf.get(id)!) : [];
    const target = sources.length ? mean(sources) : 0;
    const free = (row: number | undefined) => row !== undefined && !taken.has(row);
    for (const { id } of representations) {
      if (rows.has(id)) continue;
      // A returning representation, or a new version of one that is gone, takes the row it had; anything else takes
      // the free row closest to what it was made from.
      const replaced = previous.find((other) => baseName(other) === baseName(id) && !ids(column).includes(other));
      const remembered = [rowOf.get(id), replaced === undefined ? undefined : rowOf.get(replaced)].find(free);
      let row = remembered;
      if (row === undefined) {
        const candidates = Array.from({ length: taken.size + 1 + Math.ceil(target) }, (_, index) => index).filter((index) => !taken.has(index));
        row = candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
      }
      rows.set(id, place(id, row));
    }

    for (const representation of representations) {
      nodes.push({
        key: nodeKey(representation.id, column),
        representation,
        column,
        row: rows.get(representation.id)!,
        ...(previous.includes(representation.id) ? { carried: true } : {}),
      });
    }
  }

  const steps = process.transforms.map((transform, index): GraphStep => {
    const back = returns.get(index);
    return {
      transform,
      column: index,
      inputs: reads(index).map((id) => nodeKey(id, index)),
      // A step that closes a loop is drawn as the loop back to the state it returns to.
      outputs: back === undefined ? produces(index).map((id) => nodeKey(id, index + 1)) : [],
      ...(back !== undefined ? { back } : {}),
    };
  });

  // A carried representation is drawn again only where a step reads or points to it, in the final state, and in a state
  // a loop returns to, so that state shows everything the next round starts from.
  const read = new Set(steps.flatMap((step) => [...step.inputs, ...step.outputs]));
  const targets = new Set(steps.flatMap((step) => (step.back === undefined ? [] : [step.back])));
  const shown = (node: GraphNode) => !node.carried || read.has(node.key) || node.column === columns - 1 || targets.has(node.column);
  const drawn = nodes.map((node) => (shown(node) ? node : { ...node, through: true }));

  return { nodes: drawn, steps, columns, rows: Math.max(...nodes.map((node) => node.row)) + 1 };
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
