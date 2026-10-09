import type { StructuralFeatures } from "../grammar/features";

export interface Dimension {
  key: string;
  label: string;
  ratio?: boolean;
  value: (features: StructuralFeatures) => number;
}

const share = (count: number, total: number) => (total ? count / total : 0);

export const dimensions: Dimension[] = [
  { key: "stateCount", label: "States", value: (f) => f.stateCount },
  { key: "representationCount", label: "Representations", value: (f) => f.representationCount },
  { key: "transformCount", label: "Transformations", value: (f) => f.transformCount },
  { key: "humanTransformCount", label: "Human transformations", value: (f) => f.humanTransformCount },
  { key: "modelTransformCount", label: "Model transformations", value: (f) => f.modelTransformCount },
  { key: "toolTransformCount", label: "Tool transformations", value: (f) => f.toolTransformCount },
  { key: "stochasticTransformCount", label: "Stochastic transformations", value: (f) => f.stochasticTransformCount },
  { key: "uniqueRoles", label: "Unique roles", value: (f) => f.uniqueRoles },
  { key: "uniqueMedia", label: "Unique media", value: (f) => f.uniqueMedia },
  { key: "uniqueOperations", label: "Unique operations", value: (f) => f.uniqueOperations },
  {
    key: "humanRatio",
    label: "Human transformation ratio",
    ratio: true,
    value: (f) => share(f.humanTransformCount, f.transformCount),
  },
  {
    key: "modelRatio",
    label: "Model transformation ratio",
    ratio: true,
    value: (f) => share(f.modelTransformCount, f.transformCount),
  },
  {
    key: "toolRatio",
    label: "Tool transformation ratio",
    ratio: true,
    value: (f) => share(f.toolTransformCount, f.transformCount),
  },
];

const byKey = new Map(dimensions.map((dimension) => [dimension.key, dimension]));

export function findDimension(key: string | null | undefined): Dimension | undefined {
  return key ? byKey.get(key) : undefined;
}

export function formatDimensionValue(dimension: Dimension, value: number): string {
  return dimension.ratio ? `${Math.round(value * 100)}%` : String(Math.round(value * 100) / 100);
}
