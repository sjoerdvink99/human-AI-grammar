import { actorKinds } from "./types";
import type { Counts, StructuralFeatures } from "./features";

export type SimilarityGroup = "representation" | "transformation";

export interface SimilarityMeasure {
  label: string;
  group: SimilarityGroup;
  method: string;
  score: (a: StructuralFeatures, b: StructuralFeatures) => number;
}

export interface SimilarityResult {
  overall: number;
  representation: number;
  transformation: number;
  components: { label: string; group: SimilarityGroup; method: string; score: number }[];
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((item) => right.has(item)).length / union.size;
}

export function closeness(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 1 : 1 - Math.abs(a - b) / scale;
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

const keys = (counts: Counts) => Object.keys(counts);

const setMeasure = (label: string, group: SimilarityGroup, select: (f: StructuralFeatures) => Counts): SimilarityMeasure => ({
  label,
  group,
  method: "Jaccard",
  score: (a, b) => jaccard(keys(select(a)), keys(select(b))),
});

const countMeasure = (label: string, group: SimilarityGroup, select: (f: StructuralFeatures) => number): SimilarityMeasure => ({
  label,
  group,
  method: "1 − |a−b| / max(a,b)",
  score: (a, b) => closeness(select(a), select(b)),
});

const actorShare = (features: StructuralFeatures) =>
  actorKinds.map((kind) => (features.transformCount ? features.actors[kind] / features.transformCount : 0));

export const measures: SimilarityMeasure[] = [
  setMeasure("Roles", "representation", (f) => f.roles),
  setMeasure("Media", "representation", (f) => f.media),
  setMeasure("Role–medium pairs", "representation", (f) => f.representationTypes),
  countMeasure("States", "representation", (f) => f.stateCount),
  countMeasure("Representations", "representation", (f) => f.representationCount),
  countMeasure("Mean state size", "representation", (f) => mean(f.stateSizes)),
  setMeasure("Operations", "transformation", (f) => f.operations),
  setMeasure("Actor–operation pairs", "transformation", (f) => f.actorOperationPairs),
  countMeasure("Transformations", "transformation", (f) => f.transformCount),
  countMeasure("Stochastic transformations", "transformation", (f) => f.stochasticTransformCount),
  {
    label: "Actor distribution",
    group: "transformation",
    method: "1 − total variation distance",
    score: (a, b) => {
      const left = actorShare(a);
      const right = actorShare(b);
      return 1 - left.reduce((sum, share, index) => sum + Math.abs(share - right[index]), 0) / 2;
    },
  },
];

export function similarity(a: StructuralFeatures, b: StructuralFeatures): SimilarityResult {
  const components = measures.map(({ label, group, method, score }) => ({ label, group, method, score: score(a, b) }));
  const groupScore = (group: SimilarityGroup) =>
    mean(components.filter((component) => component.group === group).map((component) => component.score));
  const representation = groupScore("representation");
  const transformation = groupScore("transformation");
  return { overall: (representation + transformation) / 2, representation, transformation, components };
}
