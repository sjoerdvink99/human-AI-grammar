import Link from "next/link";
import type { SystemEntry } from "@/domain/systems/types";
import { processAnchor } from "@/lib/format";
import { ActorStrip } from "./actor-strip";

export interface ListedProcess {
  systemId: number;
  processId: number;
  indices?: number[];
}

export function ProcessList({ entries, items, named = true }: { entries: SystemEntry[]; items: ListedProcess[]; named?: boolean }) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const groups = new Map<number, { entry: SystemEntry; processes: { item: ListedProcess; order: number }[] }>();
  for (const item of items) {
    const entry = byId.get(item.systemId);
    const record = entry?.processes.find((process) => process.id === item.processId);
    if (!entry || !record) continue;
    if (!groups.has(entry.id)) groups.set(entry.id, { entry, processes: [] });
    groups.get(entry.id)!.processes.push({ item, order: record.order });
  }

  return (
    <ul className="space-y-3 text-[13px]">
      {[...groups.values()].map(({ entry, processes }) => (
        <li key={entry.id}>
          {named && (
            <Link href={`/systems/${entry.id}`} className="mb-1 block font-medium hover:text-accent">
              {entry.name}
            </Link>
          )}
          <ul className="space-y-1.5">
            {processes.map(({ item, order }, index) => {
              const record = entry.processes.find((process) => process.id === item.processId)!;
              return (
                <li key={`${item.processId}-${index}`} className="text-xs">
                  <Link href={`/systems/${entry.id}#${processAnchor(order)}`} className="block text-muted hover:text-ink">
                    {record.name ?? `Process ${order + 1}`}
                  </Link>
                  {record.result.ok && (
                    <div className="mt-1">
                      <ActorStrip transforms={record.result.process.transforms} highlight={item.indices && new Set(item.indices)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function PanelHeading({ title, detail }: { title: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="mb-3 border-b border-line pb-3">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}
