import type { Process, State } from "../grammar/types";

export interface Dependency {
  from: number;
  to: number;
  via: string[];
}

export interface FlowLink {
  from: number;
  to: number;
  back: boolean;
}

export interface Flow {
  dependencies: Dependency[];
  stages: number[][];
  links: FlowLink[];
}

const ids = (state: State) => state.representations.map((representation) => representation.id);

const unique = <T>(items: T[]) => [...new Set(items)];

export function dependencies(processes: (Process | null)[]): Dependency[] {
  const inputs = processes.map((process) => (process ? unique(ids(process.states[0])) : []));
  const outputs = processes.map((process, index) =>
    process ? unique(process.states.slice(1).flatMap(ids)).filter((id) => !inputs[index].includes(id)) : [],
  );
  return processes.flatMap((_, from) =>
    processes.flatMap((__, to) => {
      const via = from === to ? [] : inputs[to].filter((id) => outputs[from].includes(id));
      return via.length ? [{ from, to, via }] : [];
    }),
  );
}

export function flow(processes: (Process | null)[]): Flow {
  const deps = dependencies(processes);
  const present = processes.flatMap((process, index) => (process ? [index] : []));
  const next = (index: number) => deps.filter((dep) => dep.from === index).map((dep) => dep.to);
  const hasIncoming = (index: number) => deps.some((dep) => dep.to === index);

  const back = new Set<string>();
  const visited = new Set<number>();
  const onPath = new Set<number>();
  const visit = (index: number) => {
    visited.add(index);
    onPath.add(index);
    for (const to of next(index)) {
      if (onPath.has(to)) back.add(`${index}>${to}`);
      else if (!visited.has(to)) visit(to);
    }
    onPath.delete(index);
  };
  [...present.filter((index) => !hasIncoming(index)), ...present].forEach((index) => visited.has(index) || visit(index));

  const forward = deps.filter((dep) => !back.has(`${dep.from}>${dep.to}`));
  const stage = new Map(present.map((index) => [index, 0]));
  for (let pass = 0; pass < present.length; pass++) {
    for (const { from, to } of forward) stage.set(to, Math.max(stage.get(to)!, stage.get(from)! + 1));
  }

  const reachable = (from: number, to: number, skip: Dependency) => {
    const seen = new Set<number>();
    const stack = forward.filter((dep) => dep !== skip && dep.from === from).map((dep) => dep.to);
    while (stack.length) {
      const index = stack.pop()!;
      if (index === to) return true;
      if (seen.has(index)) continue;
      seen.add(index);
      stack.push(...forward.filter((dep) => dep.from === index).map((dep) => dep.to));
    }
    return false;
  };

  const links: FlowLink[] = [
    ...forward.filter((dep) => !reachable(dep.from, dep.to, dep)).map(({ from, to }) => ({ from, to, back: false })),
    ...deps.filter((dep) => back.has(`${dep.from}>${dep.to}`)).map(({ from, to }) => ({ from, to, back: true })),
  ];

  const depth = Math.max(0, ...stage.values());
  const stages = Array.from({ length: depth + 1 }, (_, level) => present.filter((index) => stage.get(index) === level));

  return { dependencies: deps, stages, links };
}
