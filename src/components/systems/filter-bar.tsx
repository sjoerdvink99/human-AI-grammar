"use client";

import { Search, X } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import { dimensions, findDimension } from "@/domain/systems/dimensions";
import type { Facets } from "@/domain/systems/facets";
import { emptyQuery, isQueryActive, type Range, type SystemQuery } from "@/domain/systems/filters";
import { cx } from "@/lib/cx";
import { RangeInput } from "./range-input";

const pinnedRanges = ["transformCount", "representationCount"];

const facetControls: { key: keyof Facets & keyof SystemQuery; label: string }[] = [
  { key: "actors", label: "Actor" },
  { key: "operations", label: "Operation" },
  { key: "actorOperations", label: "Actor · operation" },
  { key: "roles", label: "Role" },
  { key: "media", label: "Medium" },
  { key: "representationTypes", label: "Role · medium" },
  { key: "venues", label: "Venue" },
  { key: "scopes", label: "Scope" },
];

export function FilterBar({
  facets,
  query,
  onChange,
  resultCount,
  total,
}: {
  facets: Facets;
  query: SystemQuery;
  onChange: (changes: Partial<SystemQuery>) => void;
  resultCount: number;
  total: number;
}) {
  const rangeKeys = [...new Set([...pinnedRanges, ...Object.keys(query.ranges)])].filter((key) => findDimension(key));
  const addable = dimensions.filter((dimension) => !rangeKeys.includes(dimension.key));
  const removeRange = (key: string) =>
    onChange({ ranges: Object.fromEntries(Object.entries(query.ranges).filter(([existing]) => existing !== key)) });
  const setRange = (key: string, range: Range) =>
    pinnedRanges.includes(key) && range.min === undefined && range.max === undefined
      ? removeRange(key)
      : onChange({ ranges: { ...query.ranges, [key]: range } });

  return (
    <div className="mb-5 space-y-2.5 border-b border-line pb-4">
      <div className="flex items-center gap-3">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-faint" />
          <input
            type="search"
            value={query.text}
            onChange={(event) => onChange({ text: event.target.value })}
            placeholder="Search systems, papers, authors, tags, expressions, vocabulary"
            className="h-8 w-full rounded border border-line-strong bg-white pr-2.5 pl-8 text-[13px] placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none"
          />
        </label>
        <span className="text-xs whitespace-nowrap text-muted tabular-nums">
          {resultCount === total ? `${total} systems` : `${resultCount} of ${total} systems`}
        </span>
        <button
          type="button"
          onClick={() => onChange(emptyQuery)}
          disabled={!isQueryActive(query)}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink disabled:invisible"
        >
          <X className="size-3" />
          Clear filters
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {facetControls.map(({ key, label }) => (
          <MultiSelect
            key={key}
            label={label}
            options={facets[key]}
            selected={query[key]}
            onChange={(selected) => onChange({ [key]: selected })}
          />
        ))}
        <label
          className={cx(
            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-xs",
            query.stochastic ? "border-accent/50 bg-accent-wash text-accent" : "border-line-strong text-muted hover:text-ink",
          )}
        >
          <input
            type="checkbox"
            checked={query.stochastic}
            onChange={(event) => onChange({ stochastic: event.target.checked })}
            className="accent-accent"
          />
          Stochastic <span className="font-mono">~</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <RangeInput label="Year" range={query.year} onChange={(year) => onChange({ year })} />
        {rangeKeys.map((key) => {
          const dimension = findDimension(key)!;
          return (
            <span key={key} className="inline-flex items-center gap-1">
              <RangeInput
                label={dimension.label}
                range={query.ranges[key] ?? {}}
                step={dimension.ratio ? 0.1 : 1}
                onChange={(range) => setRange(key, range)}
              />
              {!pinnedRanges.includes(key) && (
                <button type="button" onClick={() => removeRange(key)} aria-label={`Remove ${dimension.label} range`}>
                  <X className="size-3 text-faint hover:text-ink" />
                </button>
              )}
            </span>
          );
        })}
        {addable.length > 0 && (
          <select
            value=""
            onChange={(event) => setRange(event.target.value, {})}
            className="h-7 w-auto rounded border border-dashed border-line-strong bg-white px-1.5 text-xs text-muted hover:text-ink focus:outline-none"
          >
            <option value="">+ Range on…</option>
            {addable.map((dimension) => (
              <option key={dimension.key} value={dimension.key}>
                {dimension.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
