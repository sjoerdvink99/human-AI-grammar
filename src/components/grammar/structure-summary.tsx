import type { StructuralFeatures } from "@/domain/grammar/features";

export function StructureSummary({ features }: { features: StructuralFeatures }) {
  const groups = [
    [
      ["States", features.stateCount],
      ["Representations", features.representationCount],
      ["Transformations", features.transformCount],
      ["Generative", features.generativeTransformCount],
      ["Collections", features.collectionCount],
      ["Loops", features.loopCount],
    ],
    [
      ["Human", features.humanTransformCount],
      ["Model", features.modelTransformCount],
      ["Tool", features.toolTransformCount],
    ],
    [
      ["Unique roles", features.uniqueRoles],
      ["Unique media", features.uniqueMedia],
      ["Unique operations", features.uniqueOperations],
    ],
  ] as const;

  return (
    <div className="grid grid-cols-3 divide-x divide-line border-y border-line">
      {groups.map((group, index) => (
        <dl key={index} className="grid grid-cols-[1fr_auto] content-start gap-x-4 gap-y-1 px-4 py-3 first:pl-0">
          {group.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[13px] text-muted">{label}</dt>
              <dd className="text-right text-[13px] font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}
