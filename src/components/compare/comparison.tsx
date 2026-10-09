import Link from "next/link";
import { ProcessList } from "@/components/grammar/process-list";
import { Section } from "@/components/ui/section";
import { meanStateSize, pairwiseSimilarity, partitionField, repeated, type TermField } from "@/domain/analysis/comparison";
import type { SystemEntry } from "@/domain/systems/types";
import { shortAuthors } from "@/lib/format";
import { ActorBar, ActorLegend } from "./actor-bar";
import { ComparisonGrid, ComparisonRow, SpanningRow } from "./comparison-grid";
import { SimilarityTable } from "./similarity-table";
import { TermLegend, TermList } from "./term-list";

function Counted({ entries }: { entries: [string, number][] }) {
  if (entries.length === 0) return <span className="text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[12.5px]">
      {entries.map(([term, count]) => (
        <span key={term}>
          {term}
          <span className="ml-1 text-faint">×{count}</span>
        </span>
      ))}
    </span>
  );
}

export function Comparison({ entries }: { entries: SystemEntry[] }) {
  const columns = entries.length;
  const cells = (render: (entry: SystemEntry, index: number) => React.ReactNode) => entries.map(render);
  const terms = (field: TermField) => {
    const partition = partitionField(entries, field);
    return cells((entry, index) => (
      <TermList terms={Object.keys(entry.features[field])} shared={partition.shared} unique={partition.unique[index]} />
    ));
  };
  const vocabularyFields: [string, TermField][] = [
    ["role", "roles"],
    ["medium", "media"],
    ["operation", "operations"],
  ];
  const partitions = vocabularyFields.map(([label, field]) => [label, partitionField(entries, field)] as const);
  const [roles, media, operations] = partitions.map(([, partition]) => partition);
  const emphasis = (index: number) => ({
    roles: roles.unique[index],
    media: media.unique[index],
    operations: operations.unique[index],
  });

  return (
    <div className="mt-8">
      <ComparisonGrid columns={columns}>
        <div />
        {entries.map((entry) => (
          <div key={entry.id} className="min-w-0 border-b border-line-strong px-3 pt-1 pb-2.5">
            <Link href={`/systems/${entry.id}`} className="text-[14px] font-semibold hover:text-accent">
              {entry.name}
            </Link>
            <p className="truncate text-xs text-muted">
              {shortAuthors(entry.paper.authors)} · {entry.paper.venue} {entry.paper.year}
            </p>
          </div>
        ))}
      </ComparisonGrid>

      <Section title="Representations" aside={<TermLegend />} className="mt-8">
        <ComparisonGrid columns={columns}>
          <ComparisonRow label="States" cells={cells((entry) => <span className="tabular-nums">{entry.features.stateCount}</span>)} />
          <ComparisonRow
            label="Representations"
            hint="distinct id · role · medium"
            cells={cells((entry) => <span className="tabular-nums">{entry.features.representationCount}</span>)}
          />
          <ComparisonRow label="Roles" cells={terms("roles")} />
          <ComparisonRow label="Media" cells={terms("media")} />
          <ComparisonRow label="Role · medium" cells={terms("representationTypes")} />
          <SpanningRow label="Shared vocabulary">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {partitions.map(([label, partition]) => (
                <span key={label}>
                  <span className="mr-2 text-xs text-faint">{label}</span>
                  <span className="font-mono text-[12.5px]">{partition.shared.join(", ") || "—"}</span>
                </span>
              ))}
            </div>
          </SpanningRow>
          <ComparisonRow
            label="Unique vocabulary"
            cells={cells((_, index) => {
              const unique = partitions.flatMap(([label, partition]) => partition.unique[index].map((term) => [label, term]));
              return unique.length ? (
                <span className="flex flex-col gap-0.5">
                  {unique.map(([label, term]) => (
                    <span key={`${label}:${term}`}>
                      <span className="inline-block w-16 text-xs text-faint">{label}</span>
                      <span className="font-mono text-[12.5px] text-accent">{term}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-faint">—</span>
              );
            })}
          />
        </ComparisonGrid>
      </Section>

      <Section title="Transformations" aside={<ActorLegend />}>
        <ComparisonGrid columns={columns}>
          <ComparisonRow
            label="Transformations"
            cells={cells((entry) => <span className="tabular-nums">{entry.features.transformCount}</span>)}
          />
          <ComparisonRow label="Actors" cells={cells((entry) => <ActorBar actors={entry.features.actors} />)} />
          <ComparisonRow label="Operations" cells={terms("operations")} />
          <ComparisonRow label="Actor · operation" cells={terms("actorOperationPairs")} />
          <ComparisonRow
            label="Stochastic"
            cells={cells((entry) => (
              <span className="tabular-nums">
                {entry.features.stochasticTransformCount}
                <span className="text-faint"> of {entry.features.transformCount}</span>
              </span>
            ))}
          />
        </ComparisonGrid>
      </Section>

      <Section title="Process structure">
        <ComparisonGrid columns={columns}>
          <ComparisonRow
            label="Sequence lengths"
            hint="transformations per process"
            cells={cells((entry) => <span className="font-mono text-[12.5px]">{entry.features.processLengths.join(" · ")}</span>)}
          />
          <ComparisonRow
            label="State sizes"
            hint="representations per state"
            cells={cells((entry) => (
              <span className="font-mono text-[12.5px]">
                {entry.features.stateSizes.join(" ")}
                <span className="ml-2 font-sans text-xs text-faint">mean {meanStateSize(entry.features).toFixed(1)}</span>
              </span>
            ))}
          />
          <ComparisonRow
            label="Repeated pairs"
            hint="actor · operation"
            cells={cells((entry) => <Counted entries={repeated(entry.features.actorOperationPairs)} />)}
          />
          <ComparisonRow
            label="Handoffs"
            hint="between consecutive transformations"
            cells={cells((entry) => <Counted entries={Object.entries(entry.features.handoffs)} />)}
          />
        </ComparisonGrid>
      </Section>

      <Section title="Structural similarity">
        <SimilarityTable pairs={pairwiseSimilarity(entries)} />
      </Section>

      <Section title="Grammar expressions" aside="Highlighted terms occur only in that system">
        <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {entries.map((entry, index) => (
            <div key={entry.id} className="min-w-0">
              <p className="mb-1 text-[13px] font-semibold">{entry.name}</p>
              <ProcessList processes={entry.processes} emphasis={emphasis(index)} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
