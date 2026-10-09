import Link from "next/link";
import { oversight, parsedProcesses, type Oversight } from "@/domain/analysis/structure";
import type { Process } from "@/domain/grammar/types";
import type { SystemEntry } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { ActorStrip } from "./actor-strip";
import { PanelHeading, ProcessList } from "./process-list";

export const stripSorts = ["run", "name", "year"] as const;

export type StripSort = (typeof stripSorts)[number];

export const stripSortLabels: Record<StripSort, string> = { run: "longest model run", name: "name", year: "year" };

export interface SystemStrips {
  entry: SystemEntry;
  processes: { id: number; process: Process }[];
  oversight: Oversight;
}

export function systemStrips(entries: SystemEntry[], sort: StripSort): SystemStrips[] {
  const parsed = parsedProcesses(entries);
  const rows = entries.map((entry) => {
    const processes = parsed.filter((ref) => ref.systemId === entry.id).map(({ processId, process }) => ({ id: processId, process }));
    return { entry, processes, oversight: oversight(processes.map(({ process }) => process)) };
  });
  const byName = (a: SystemStrips, b: SystemStrips) => a.entry.name.localeCompare(b.entry.name);
  return rows.sort((a, b) =>
    sort === "run"
      ? b.oversight.longestModelRun - a.oversight.longestModelRun || byName(a, b)
      : sort === "year"
        ? b.entry.paper.year - a.entry.paper.year || byName(a, b)
        : byName(a, b),
  );
}

export function ProcessStrips({ rows, selectedId, onSelect }: { rows: SystemStrips[]; selectedId?: number; onSelect: (id: number | undefined) => void }) {
  return (
    <div className="text-[13px]">
      <div className="grid grid-cols-[11rem_1fr_3rem] gap-4 px-2 pb-2 text-[11px] text-faint">
        <span>System</span>
        <span>Processes</span>
        <span className="text-right">Run</span>
      </div>
      {rows.map(({ entry, processes, oversight }) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.id === selectedId ? undefined : entry.id)}
          className={cx(
            "grid w-full grid-cols-[11rem_1fr_3rem] items-start gap-4 border-t border-line px-2 py-1.5 text-left hover:bg-wash",
            entry.id === selectedId && "bg-wash",
          )}
        >
          <span className="truncate">{entry.name}</span>
          <span className="flex flex-wrap gap-x-2.5 gap-y-1.5 pt-px">
            {processes.map(({ id, process }) => (
              <ActorStrip key={id} transforms={process.transforms} />
            ))}
          </span>
          <span className="text-right text-xs text-muted tabular-nums">{oversight.longestModelRun}</span>
        </button>
      ))}
    </div>
  );
}

export function StripPanel({ row, entries }: { row?: SystemStrips; entries: SystemEntry[] }) {
  if (!row) {
    return (
      <div className="space-y-2 text-xs text-muted">
        <PanelHeading title="Processes" />
        <p>Each row is a system and each strip one of its processes, read left to right.</p>
        <p>Run is the longest sequence of model transformations without a human transformation in between.</p>
        <p>Select a system to see where its people act on model output.</p>
      </div>
    );
  }
  const { entry, processes, oversight } = row;
  const next = [
    ["a human acts next", oversight.next.human],
    ["another model acts next", oversight.next.model],
    ["the process ends", oversight.next.end],
  ] as const;
  return (
    <div>
      <PanelHeading
        title={
          <Link href={`/systems/${entry.id}`} className="hover:text-accent">
            {entry.name}
          </Link>
        }
        detail={`${entry.paper.venue} ${entry.paper.year}`}
      />
      {oversight.generativeOutputs > 0 && (
        <dl className="mb-4 space-y-1 text-xs">
          <dt className="mb-1.5 text-muted">After a generative output</dt>
          {next.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dd>{label}</dd>
              <dd className="text-muted tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ProcessList entries={entries} items={processes.map(({ id }) => ({ systemId: entry.id, processId: id }))} named={false} />
    </div>
  );
}
