import { dimensions, type Dimension } from "../systems/dimensions";
import type { SystemEntry } from "../systems/types";
import { kMeans, normalize } from "./clustering";

export interface StructuralGroup {
  index: number;
  systemIds: number[];
  distinctive: Dimension[];
}

export interface Grouping {
  groupOf: Map<number, number>;
  groups: StructuralGroup[];
}

export function groupSystems(entries: SystemEntry[], k: number): Grouping {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  const vectors = normalize(sorted.map((entry) => dimensions.map((dimension) => dimension.value(entry.features))));
  const assignments = kMeans(vectors, k);
  const overall = dimensions.map((_, d) => vectors.reduce((sum, vector) => sum + vector[d], 0) / (vectors.length || 1));

  const order = [...new Set(assignments)];
  const groups = order.map((cluster, index) => {
    const members = vectors.filter((_, i) => assignments[i] === cluster);
    const deviation = dimensions.map((dimension, d) => ({
      dimension,
      delta: members.reduce((sum, vector) => sum + vector[d], 0) / members.length - overall[d],
    }));
    return {
      index,
      systemIds: sorted.filter((_, i) => assignments[i] === cluster).map((entry) => entry.id),
      distinctive: deviation
        .filter(({ delta }) => delta > 0.15)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 3)
        .map(({ dimension }) => dimension),
    };
  });

  return {
    groupOf: new Map(groups.flatMap((group) => group.systemIds.map((id) => [id, group.index] as const))),
    groups,
  };
}
