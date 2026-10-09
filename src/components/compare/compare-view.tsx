"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { maxCompared } from "@/domain/analysis/comparison";
import type { SystemEntry } from "@/domain/systems/types";
import { useUrlState } from "@/lib/use-url-state";
import { CompareSelector } from "./compare-selector";
import { Comparison } from "./comparison";

function parseIds(value: string | null): number[] {
  return [...new Set((value ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, maxCompared);
}

export function CompareView({ entries }: { entries: SystemEntry[] }) {
  const [params, update] = useUrlState();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const selected = parseIds(params.get("ids")).flatMap((id) => byId.get(id) ?? []);
  const select = (ids: number[]) => update((next) => (ids.length ? next.set("ids", ids.join(",")) : next.delete("ids")));

  return (
    <>
      <CompareSelector
        options={entries.map(({ id, name }) => ({ id, name }))}
        selectedIds={selected.map((entry) => entry.id)}
        onChange={select}
      />
      {selected.length >= 2 ? (
        <Comparison entries={selected} />
      ) : (
        <div className="mt-6">
          <EmptyState title="Select at least two systems">
            {entries.length >= 2 ? (
              <>
                Add systems above, or start from{" "}
                <Link
                  href={`/compare?ids=${entries[0].id},${entries[1].id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    select([entries[0].id, entries[1].id]);
                  }}
                  className="text-accent hover:underline"
                >
                  {entries[0].name} and {entries[1].name}
                </Link>
                .
              </>
            ) : (
              "Comparison needs at least two systems in the repository."
            )}
          </EmptyState>
        </div>
      )}
    </>
  );
}
