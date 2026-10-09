import type { ActorKind } from "../grammar/types";

export interface RepresentationData extends Record<string, unknown> {
  name: string;
  role: string;
  medium: string;
  collection: boolean;
  note: string;
}

export interface StepData extends Record<string, unknown> {
  actor: ActorKind;
  operation: string;
  generative: boolean;
  note: string;
}

interface Position {
  x: number;
  y: number;
}

export type CanvasNode =
  | { id: string; type?: "representation"; position: Position; data: RepresentationData }
  | { id: string; type?: "step"; position: Position; data: StepData };

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface DerivedProcess {
  rawExpression: string;
  description?: string;
}

export interface Derived {
  processes: DerivedProcess[];
  representations: Record<string, string>;
  problems: string[];
}

type Representation = Extract<CanvasNode, { type?: "representation" }>;
type Step = Extract<CanvasNode, { type?: "step" }> & { inputs: string[]; outputs: string[] };

export const term = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

const unique = <T>(items: T[]) => [...new Set(items)];

const byPosition = (a: Step, b: Step) => a.position.x - b.position.x || a.position.y - b.position.y;

const shares = (a: Step, b: Step) => [...a.inputs, ...a.outputs].some((id) => b.inputs.includes(id) || b.outputs.includes(id));

const components = (steps: Step[]) =>
  steps.reduce<Step[][]>((groups, step) => {
    const linked = (group: Step[]) => group.some((other) => shares(other, step));
    return [...groups.filter((group) => !linked(group)), [...groups.filter(linked).flat(), step]];
  }, []);

function order(steps: Step[]): Step[] {
  const remaining = [...steps].sort(byPosition);
  const ordered: Step[] = [];
  const precedes = (a: Step, b: Step) => a !== b && a.outputs.some((id) => b.inputs.includes(id));
  while (remaining.length) {
    const next = remaining.find((step) => !remaining.some((other) => precedes(other, step))) ?? remaining[0];
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

function identifiers(steps: Step[], representations: Map<string, Representation>): Map<string, string> {
  const ids = new Map<string, string>();
  const versions = new Map<string, number>();
  for (const node of unique(steps.flatMap((step) => [...step.inputs, ...step.outputs]))) {
    const base = term(representations.get(node)!.data.name);
    const version = (versions.get(base) ?? 0) + 1;
    versions.set(base, version);
    ids.set(node, `${base}_${version}`);
  }
  return ids;
}

function expression(steps: Step[], representations: Map<string, Representation>, ids: Map<string, string>): string {
  const state = (nodes: string[]) =>
    unique(nodes)
      .map((node) => {
        const { role, medium, collection } = representations.get(node)!.data;
        return `(${ids.get(node)}: ${term(role)} ${term(medium)})${collection ? "*" : ""}`;
      })
      .join(" + ");
  const lines = [state(steps[0].inputs)];
  steps.forEach((step, index) => {
    lines.push(`-> [${step.data.actor} ${term(step.data.operation)}]${step.data.generative ? "~" : ""}`);
    lines.push(`-> ${state([...step.outputs, ...(steps[index + 1]?.inputs ?? [])])}`);
  });
  return lines.join("\n");
}

const describeSteps = (steps: Step[]) =>
  steps
    .filter((step) => step.data.note.trim())
    .map((step) => `${step.data.actor} ${term(step.data.operation)}: ${step.data.note.trim()}`)
    .join("\n");

export function deriveProcesses({ nodes, edges }: Canvas): Derived {
  const representations = new Map(nodes.filter((node): node is Representation => node.type === "representation").map((node) => [node.id, node]));
  const complete = (id: string) => {
    const data = representations.get(id)?.data;
    return Boolean(data && term(data.name) && term(data.role) && term(data.medium));
  };
  const problems: string[] = [];
  const steps: Step[] = [];

  for (const node of nodes) {
    if (node.type !== "step") continue;
    const step = {
      ...node,
      inputs: edges.filter((edge) => edge.target === node.id).map((edge) => edge.source),
      outputs: edges.filter((edge) => edge.source === node.id).map((edge) => edge.target),
    };
    const label = `${node.data.actor} ${term(node.data.operation) || "step"}`;
    if (!term(node.data.operation)) problems.push(`A ${node.data.actor} step has no operation`);
    else if (!step.inputs.length) problems.push(`${label} has no input`);
    else if (!step.outputs.length) problems.push(`${label} has no output`);
    else if (![...step.inputs, ...step.outputs].every(complete)) problems.push(`${label} uses a representation without a name, role, or medium`);
    else steps.push(step);
  }

  const used = new Set(steps.flatMap((step) => [...step.inputs, ...step.outputs]));
  for (const [id, node] of representations) {
    if (!used.has(id)) problems.push(`${term(node.data.name) || "A representation"} is not connected to a complete step`);
  }

  const processes = components(steps)
    .map(order)
    .sort((a, b) => byPosition(a[0], b[0]))
    .map((ordered) => {
      const description = describeSteps(ordered);
      return { rawExpression: expression(ordered, representations, identifiers(ordered, representations)), ...(description && { description }) };
    });

  const notes = new Map<string, string[]>();
  for (const id of used) {
    const { name, note } = representations.get(id)!.data;
    if (note.trim()) notes.set(term(name), unique([...(notes.get(term(name)) ?? []), note.trim()]));
  }

  return { processes, representations: Object.fromEntries([...notes].map(([name, texts]) => [name, texts.join(" ")])), problems: unique(problems) };
}
