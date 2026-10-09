import type { Counts, StructuralFeatures } from "../grammar/features";
import { similarity, type SimilarityResult } from "../grammar/similarity";
import type { SystemEntry } from "../systems/types";

export const maxCompared = 4;

export type TermField = "roles" | "media" | "operations" | "representationTypes" | "actorOperationPairs";

export interface TermPartition {
  shared: string[];
  unique: string[][];
}

export interface PairSimilarity {
  a: SystemEntry;
  b: SystemEntry;
  result: SimilarityResult;
}

export function partitionTerms(sets: string[][]): TermPartition {
  const shared = sets.length ? sets[0].filter((term) => sets.every((set) => set.includes(term))) : [];
  const unique = sets.map((set, index) =>
    set.filter((term) => sets.every((other, otherIndex) => otherIndex === index || !other.includes(term))),
  );
  return { shared: shared.sort(), unique: unique.map((terms) => terms.sort()) };
}

export function partitionField(entries: SystemEntry[], field: TermField): TermPartition {
  return partitionTerms(entries.map((entry) => Object.keys(entry.features[field])));
}

export function repeated(counts: Counts): [string, number][] {
  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
}

export function pairwiseSimilarity(entries: SystemEntry[]): PairSimilarity[] {
  return entries.flatMap((a, i) => entries.slice(i + 1).map((b) => ({ a, b, result: similarity(a.features, b.features) })));
}

export function meanStateSize(features: StructuralFeatures): number {
  return features.stateSizes.length ? features.stateSizes.reduce((sum, size) => sum + size, 0) / features.stateSizes.length : 0;
}
