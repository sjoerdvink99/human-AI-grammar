"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { buildFacets } from "@/domain/systems/facets";
import { filterEntries } from "@/domain/systems/filters";
import type { SystemEntry } from "@/domain/systems/types";
import { useSystemQuery } from "@/lib/use-url-state";
import { FilterBar } from "./filter-bar";
import { sortEntries, SystemsTable, type SortDirection } from "./systems-table";

export function SystemsBrowser({ entries }: { entries: SystemEntry[] }) {
  const { query, setQuery, params, update } = useSystemQuery();
  const facets = useMemo(() => buildFacets(entries), [entries]);
  const sortKey = params.get("sort") ?? "system";
  const direction: SortDirection = params.get("dir") === "desc" ? "desc" : "asc";
  const visible = useMemo(
    () => sortEntries(filterEntries(entries, query), sortKey, direction),
    [entries, query, sortKey, direction],
  );

  const sort = (key: string) =>
    update((next) => {
      next.set("sort", key);
      next.set("dir", key === sortKey && direction === "asc" ? "desc" : "asc");
    });

  return (
    <>
      <FilterBar facets={facets} query={query} onChange={setQuery} resultCount={visible.length} total={entries.length} />
      {visible.length > 0 ? (
        <SystemsTable entries={visible} sortKey={sortKey} direction={direction} onSort={sort} />
      ) : (
        <EmptyState title="No systems match these filters">
          Filters combine with AND semantics. Remove a constraint or clear all filters.
        </EmptyState>
      )}
    </>
  );
}
