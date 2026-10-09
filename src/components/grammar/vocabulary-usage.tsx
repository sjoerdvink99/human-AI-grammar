import { Tag } from "@/components/ui/tag";
import type { StructuralFeatures } from "@/domain/grammar/features";
import { systemsHref } from "@/lib/query-params";

export function VocabularyUsage({ features }: { features: StructuralFeatures }) {
  const rows = [
    { label: "Roles", param: "role", counts: features.roles },
    { label: "Media", param: "medium", counts: features.media },
    { label: "Operations", param: "op", counts: features.operations },
    { label: "Actor · operation", param: "pair", counts: features.actorOperationPairs },
  ];
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-y-2.5">
      {rows.map(({ label, param, counts }) => (
        <div key={label} className="contents">
          <dt className="pt-0.5 text-[13px] text-muted">{label}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {Object.entries(counts).map(([term, count]) => (
              <Tag key={term} href={systemsHref({ [param]: term })}>
                <span className="font-mono">{term}</span>
                {count > 1 && <span className="ml-1.5 text-faint tabular-nums">{count}</span>}
              </Tag>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
