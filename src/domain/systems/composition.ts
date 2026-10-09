import type { Counts, StructuralFeatures } from "../grammar/features";
import type { SystemEntry } from "./types";

export interface CompositionKind {
  key: string;
  label: string;
  unit: string;
  counts: (features: StructuralFeatures) => Counts;
}

export interface CompositionPart {
  value: string;
  count: number;
}

export const compositionKinds: CompositionKind[] = [
  { key: "actors", label: "Transformations by actor", unit: "transformations", counts: (f) => f.actors },
  { key: "operations", label: "Transformations by operation", unit: "transformations", counts: (f) => f.operations },
  { key: "roles", label: "Representations by role", unit: "representations", counts: (f) => f.roles },
  { key: "media", label: "Representations by medium", unit: "representations", counts: (f) => f.media },
];

const byKey = new Map(compositionKinds.map((kind) => [kind.key, kind]));

export function findCompositionKind(key: string | null | undefined): CompositionKind | undefined {
  return key ? byKey.get(key) : undefined;
}

export function composition(entries: SystemEntry[], kind: CompositionKind): CompositionPart[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const [value, count] of Object.entries(kind.counts(entry.features))) {
      totals.set(value, (totals.get(value) ?? 0) + count);
    }
  }
  return [...totals]
    .filter(([, count]) => count > 0)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function foldParts(parts: CompositionPart[], keep: ReadonlySet<string>, otherLabel = "other"): CompositionPart[] {
  const kept = parts.filter((part) => keep.has(part.value));
  const rest = parts.filter((part) => !keep.has(part.value)).reduce((sum, part) => sum + part.count, 0);
  return rest > 0 ? [...kept, { value: otherLabel, count: rest }] : kept;
}
