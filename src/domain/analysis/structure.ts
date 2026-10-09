import { pairKey } from "../grammar/features";
import { suggestedVocabulary } from "../grammar/vocabulary";
import { actorKinds, type ActorKind, type Process, type Representation, type Transform } from "../grammar/types";
import type { ParsedProcess, SystemEntry } from "../systems/types";

export interface ProcessRef {
  systemId: number;
  processId: number;
}

export interface Step {
  transform: Transform;
  inputs: Representation[];
  outputs: Representation[];
}

export interface ParsedRef extends ProcessRef {
  entry: SystemEntry;
  record: ParsedProcess;
  process: Process;
}

export function parsedProcesses(entries: SystemEntry[]): ParsedRef[] {
  return entries.flatMap((entry) =>
    entry.processes.flatMap((record) =>
      record.result.ok ? [{ systemId: entry.id, processId: record.id, entry, record, process: record.result.process }] : [],
    ),
  );
}

function introduced(process: Process, index: number): Representation[] {
  const before = new Set(process.states[index].representations.map(({ id }) => id));
  const after = process.states[index + 1].representations;
  const added = after.filter(({ id }) => !before.has(id));
  return added.length ? added : after;
}

export function processSteps(process: Process): Step[] {
  return process.transforms.map((transform, index) => ({
    transform,
    inputs: index === 0 ? process.states[0].representations : introduced(process, index - 1),
    outputs: introduced(process, index),
  }));
}

export type Successor = "human" | "model" | "end";

export function successorOf(transforms: Transform[], index: number): Successor {
  const next = transforms.slice(index + 1).find((transform) => transform.actor !== "tool");
  return next ? (next.actor as Successor) : "end";
}

export interface Oversight {
  generativeOutputs: number;
  next: Record<Successor, number>;
  longestModelRun: number;
}

export function longestModelRun(transforms: Transform[]): number {
  let longest = 0;
  let run = 0;
  for (const { actor } of transforms) {
    if (actor === "human") run = 0;
    else if (actor === "model") longest = Math.max(longest, ++run);
  }
  return longest;
}

export function oversight(processes: Process[]): Oversight {
  const next: Record<Successor, number> = { human: 0, model: 0, end: 0 };
  let generativeOutputs = 0;
  for (const { transforms } of processes) {
    transforms.forEach((transform, index) => {
      if (!transform.generative) return;
      generativeOutputs += 1;
      next[successorOf(transforms, index)] += 1;
    });
  }
  return { generativeOutputs, next, longestModelRun: Math.max(0, ...processes.map((process) => longestModelRun(process.transforms))) };
}

export interface MotifStep {
  actor: ActorKind;
  operation: string;
}

export interface MotifOccurrence extends ProcessRef {
  indices: number[];
}

export interface Motif {
  key: string;
  steps: MotifStep[];
  systems: number;
  occurrences: MotifOccurrence[];
}

const stepKey = ({ actor, operation }: MotifStep) => `${actor} ${operation}`;

export function motifs(entries: SystemEntry[], length: number, includeTools: boolean): Motif[] {
  const found = new Map<string, Motif & { systemIds: Set<number> }>();
  for (const { systemId, processId, process } of parsedProcesses(entries)) {
    const kept = process.transforms.flatMap((transform, index) => (includeTools || transform.actor !== "tool" ? [{ transform, index }] : []));
    for (let start = 0; start + length <= kept.length; start++) {
      const window = kept.slice(start, start + length);
      const steps = window.map(({ transform }) => ({ actor: transform.actor, operation: transform.operation }));
      const key = steps.map(stepKey).join(" → ");
      let motif = found.get(key);
      if (!motif) found.set(key, (motif = { key, steps, systems: 0, occurrences: [], systemIds: new Set() }));
      motif.occurrences.push({ systemId, processId, indices: window.map(({ index }) => index) });
      motif.systemIds.add(systemId);
    }
  }
  return [...found.values()]
    .map(({ systemIds, ...motif }) => ({ ...motif, systems: systemIds.size }))
    .sort((a, b) => b.systems - a.systems || b.occurrences.length - a.occurrences.length || a.key.localeCompare(b.key));
}

export type FlowLevel = "role" | "medium" | "type";

export const flowLevels: FlowLevel[] = ["role", "medium", "type"];

const typeAt = (representation: Representation, level: FlowLevel) =>
  level === "type" ? pairKey(representation.role, representation.medium) : representation[level];

const typesAt = (representations: Representation[], level: FlowLevel) =>
  [...new Set(representations.map((representation) => typeAt(representation, level)))];

export interface FlowLink {
  key: string;
  side: "in" | "out";
  type: string;
  actor: ActorKind;
  count: number;
  refs: ProcessRef[];
}

export interface Flow {
  inputs: string[];
  outputs: string[];
  links: FlowLink[];
}

export function flow(entries: SystemEntry[], level: FlowLevel): Flow {
  const links = new Map<string, FlowLink>();
  const add = (side: FlowLink["side"], type: string, actor: ActorKind, ref: ProcessRef) => {
    const key = `${side}\u0000${type}\u0000${actor}`;
    let link = links.get(key);
    if (!link) links.set(key, (link = { key, side, type, actor, count: 0, refs: [] }));
    link.count += 1;
    if (!link.refs.some((other) => other.systemId === ref.systemId && other.processId === ref.processId)) link.refs.push(ref);
  };
  for (const { systemId, processId, process } of parsedProcesses(entries)) {
    for (const step of processSteps(process)) {
      for (const type of typesAt(step.inputs, level)) add("in", type, step.transform.actor, { systemId, processId });
      for (const type of typesAt(step.outputs, level)) add("out", type, step.transform.actor, { systemId, processId });
    }
  }
  const ranked = (side: FlowLink["side"]) => {
    const totals = new Map<string, number>();
    for (const link of links.values()) if (link.side === side) totals.set(link.type, (totals.get(link.type) ?? 0) + link.count);
    return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type]) => type);
  };
  return { inputs: ranked("in"), outputs: ranked("out"), links: [...links.values()] };
}

export type GridKind = "representations" | "transformations";

export interface GridCell {
  row: string;
  column: string;
  systems: number;
  refs: ProcessRef[];
}

export interface Grid {
  rows: string[];
  columns: string[];
  cells: Map<string, GridCell>;
}

export const cellKey = (row: string, column: string) => `${row} ${column}`;

function ordered(seed: string[], observed: Map<string, number>) {
  return [...new Set([...seed, ...observed.keys()])].sort((a, b) => (observed.get(b) ?? 0) - (observed.get(a) ?? 0) || a.localeCompare(b));
}

export function grid(entries: SystemEntry[], kind: GridKind): Grid {
  const cells = new Map<string, GridCell & { systemIds: Set<number> }>();
  const rowTotals = new Map<string, number>();
  const columnTotals = new Map<string, number>();
  const add = (row: string, column: string, ref: ProcessRef) => {
    const key = cellKey(row, column);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { row, column, systems: 0, refs: [], systemIds: new Set() }));
    cell.systemIds.add(ref.systemId);
    if (!cell.refs.some((other) => other.systemId === ref.systemId && other.processId === ref.processId)) cell.refs.push(ref);
    rowTotals.set(row, (rowTotals.get(row) ?? 0) + 1);
    columnTotals.set(column, (columnTotals.get(column) ?? 0) + 1);
  };
  for (const { systemId, processId, process } of parsedProcesses(entries)) {
    const ref = { systemId, processId };
    if (kind === "transformations") {
      for (const transform of process.transforms) add(transform.actor, transform.operation, ref);
    } else {
      const seen = new Set<string>();
      for (const representation of process.states.flatMap((state) => state.representations)) {
        if (seen.has(representation.id)) continue;
        seen.add(representation.id);
        add(representation.role, representation.medium, ref);
      }
    }
  }
  const rows = kind === "transformations" ? [...actorKinds] : ordered(suggestedVocabulary.role, rowTotals);
  const columns = ordered(kind === "transformations" ? suggestedVocabulary.operation : suggestedVocabulary.medium, columnTotals);
  return {
    rows,
    columns,
    cells: new Map([...cells].map(([key, { systemIds, ...cell }]) => [key, { ...cell, systems: systemIds.size }])),
  };
}
