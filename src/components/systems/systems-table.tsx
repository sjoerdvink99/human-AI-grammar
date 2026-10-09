"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SystemEntry } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { shortAuthors } from "@/lib/format";

export type SortDirection = "asc" | "desc";

interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  className?: string;
  value: (entry: SystemEntry) => string | number;
}

const columns: Column[] = [
  { key: "system", label: "System", className: "w-[16%]", value: (e) => e.name },
  { key: "paper", label: "Paper", value: (e) => e.paper.title },
  { key: "year", label: "Year", numeric: true, className: "w-16", value: (e) => e.paper.year },
  { key: "venue", label: "Venue", className: "w-24", value: (e) => e.paper.venue },
  { key: "scope", label: "Process scope", className: "w-40", value: (e) => e.processScope ?? "" },
  { key: "representations", label: "Reps", numeric: true, className: "w-16", value: (e) => e.features.representationCount },
  { key: "transforms", label: "Transf.", numeric: true, className: "w-16", value: (e) => e.features.transformCount },
];

export function sortEntries(entries: SystemEntry[], sortKey: string, direction: SortDirection): SystemEntry[] {
  const column = columns.find((candidate) => candidate.key === sortKey) ?? columns[0];
  const sign = direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sign * order || a.name.localeCompare(b.name);
  });
}

export function SystemsTable({
  entries,
  sortKey,
  direction,
  onSort,
}: {
  entries: SystemEntry[];
  sortKey: string;
  direction: SortDirection;
  onSort: (key: string) => void;
}) {
  const router = useRouter();
  const SortIcon = direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-line-strong">
          {columns.map((column) => (
            <th
              key={column.key}
              aria-sort={column.key === sortKey ? (direction === "asc" ? "ascending" : "descending") : undefined}
              className={cx("px-2 py-2 align-middle font-medium first:pl-0 last:pr-0", column.numeric ? "text-right" : "text-left", column.className)}
            >
              <button
                type="button"
                onClick={() => onSort(column.key)}
                className={cx(
                  "flex w-full items-center gap-1 text-xs hover:text-ink",
                  column.key === sortKey ? "text-ink" : "text-muted",
                  column.numeric && "flex-row-reverse",
                )}
              >
                {column.label}
                <SortIcon className={cx("size-3", column.key !== sortKey && "invisible")} />
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr
            key={entry.id}
            onClick={() => router.push(`/systems/${entry.id}`)}
            className="cursor-pointer border-b border-line hover:bg-wash"
          >
            <td className="truncate py-2 pr-2 font-medium">
              <Link href={`/systems/${entry.id}`} onClick={(event) => event.stopPropagation()} className="hover:text-accent">
                {entry.name}
              </Link>
            </td>
            <td className="truncate px-2 py-2" title={entry.paper.title}>
              {entry.paper.title}
              <span className="ml-2 text-muted">{shortAuthors(entry.paper.authors)}</span>
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{entry.paper.year}</td>
            <td className="truncate px-2 py-2">{entry.paper.venue}</td>
            <td className="truncate px-2 py-2 text-muted">{entry.processScope ?? "—"}</td>
            <td className="px-2 py-2 text-right tabular-nums">{entry.features.representationCount}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{entry.features.transformCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
