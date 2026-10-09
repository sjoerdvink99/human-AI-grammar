import type { Process, State } from "../grammar/types";

export interface Connection {
  from: number;
  to: number;
  kind: "continues" | "shares";
  via: string[];
}

const ids = (state: State) => state.representations.map((representation) => representation.id);

const baseName = (id: string) => id.replace(/_\d+$/, "");

const intersect = (a: string[], b: string[]) => [...new Set(a)].filter((item) => b.includes(item));

export function connections(processes: (Process | null)[]): Connection[] {
  const handoffs: Connection[] = [];
  processes.forEach((from, i) =>
    processes.forEach((to, j) => {
      if (!from || !to || i === j) return;
      const via = intersect(ids(from.states[from.states.length - 1]), ids(to.states[0]));
      if (via.length) handoffs.push({ from: i, to: j, kind: "continues", via });
    }),
  );
  const linked = (i: number, j: number) => handoffs.some((c) => (c.from === i && c.to === j) || (c.from === j && c.to === i));
  const names = processes.map((process) => (process ? process.states.flatMap(ids).map(baseName) : []));
  const shared: Connection[] = [];
  processes.forEach((_, i) =>
    processes.forEach((__, j) => {
      if (j <= i || linked(i, j)) return;
      const via = intersect(names[i], names[j]);
      if (via.length) shared.push({ from: i, to: j, kind: "shares", via });
    }),
  );
  return [...handoffs, ...shared];
}
