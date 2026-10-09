import { Fragment } from "react";
import type { Motif } from "@/domain/analysis/structure";
import type { SystemEntry } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { plural } from "@/lib/format";
import { Step } from "./actor-strip";
import { PanelHeading, ProcessList } from "./process-list";

export const motifLimit = 60;

function Sequence({ motif }: { motif: Motif }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {motif.steps.map((step, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className="text-faint" aria-hidden>
              →
            </span>
          )}
          <Step {...step} />
        </Fragment>
      ))}
    </span>
  );
}

export function MotifList({ motifs, selectedKey, onSelect }: { motifs: Motif[]; selectedKey?: string; onSelect: (key: string | undefined) => void }) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_5rem] gap-4 px-2 pb-2 text-[11px] text-faint">
        <span>Sequence</span>
        <span className="text-right">Systems</span>
      </div>
      {motifs.map((motif) => (
        <button
          key={motif.key}
          type="button"
          onClick={() => onSelect(motif.key === selectedKey ? undefined : motif.key)}
          className={cx(
            "grid w-full grid-cols-[1fr_5rem] items-center gap-4 border-t border-line px-2 py-2 text-left hover:bg-wash",
            motif.key === selectedKey && "bg-wash",
          )}
        >
          <Sequence motif={motif} />
          <span className="text-right text-xs text-muted tabular-nums">{motif.systems}</span>
        </button>
      ))}
    </div>
  );
}

export function MotifPanel({ motif, entries }: { motif?: Motif; entries: SystemEntry[] }) {
  if (!motif) {
    return (
      <div className="space-y-2 text-xs text-muted">
        <PanelHeading title="Motifs" />
        <p>Motifs are sequences of transformations that recur across systems, ranked by how many systems contain them.</p>
        <p>Hiding tools shows how humans and models hand work to each other.</p>
        <p>Select a motif to see where it occurs.</p>
      </div>
    );
  }
  return (
    <div>
      <PanelHeading
        title={<Sequence motif={motif} />}
        detail={`${plural(motif.occurrences.length, "occurrence")} in ${plural(motif.systems, "system")}`}
      />
      <ProcessList entries={entries} items={motif.occurrences} />
    </div>
  );
}
