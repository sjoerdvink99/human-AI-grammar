import Link from "next/link";
import { ArrowRight, GitCompare } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { formatDimensionValue, type Dimension } from "@/domain/systems/dimensions";
import type { SystemEntry } from "@/domain/systems/types";
import { shortAuthors } from "@/lib/format";

export function SelectionPanel({ entry, dimensions }: { entry?: SystemEntry; dimensions: Dimension[] }) {
  if (!entry) {
    return (
      <p className="text-[13px] leading-relaxed text-faint">
        Hover a point for its values. Click a point to inspect the system here.
      </p>
    );
  }
  const { features } = entry;
  const rows: [string, string | number][] = [
    ...dimensions.map((dimension): [string, string] => [dimension.label, formatDimensionValue(dimension, dimension.value(features))]),
    ["Human · model · tool", `${features.humanTransformCount} · ${features.modelTransformCount} · ${features.toolTransformCount}`],
  ];

  return (
    <div>
      <h3 className="text-[15px] font-semibold">{entry.name}</h3>
      <p className="mt-0.5 text-xs leading-snug text-muted">
        {shortAuthors(entry.paper.authors)} · {entry.paper.venue} {entry.paper.year}
      </p>
      {entry.description && <p className="mt-3 line-clamp-4 text-[13px] leading-relaxed">{entry.description}</p>}
      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted">{label}</dt>
            <dd className="text-right font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed">
        <span className="text-muted">Operations </span>
        <span className="font-mono">{Object.keys(features.operations).join(", ")}</span>
      </p>
      <div className="mt-4 flex gap-2">
        <Link href={`/systems/${entry.id}`} className={buttonClass("primary")}>
          Open system
          <ArrowRight className="size-3.5" />
        </Link>
        <Link href={`/compare?ids=${entry.id}`} className={buttonClass("ghost")}>
          <GitCompare className="size-3.5" />
          Compare
        </Link>
      </div>
    </div>
  );
}
