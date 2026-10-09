"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { FilterBar } from "@/components/systems/filter-bar";
import { Select } from "@/components/ui/field";
import { groupSystems } from "@/domain/analysis/groups";
import { composition, compositionKinds, findCompositionKind, foldParts } from "@/domain/systems/composition";
import { dimensions, findDimension, formatDimensionValue } from "@/domain/systems/dimensions";
import { buildFacets } from "@/domain/systems/facets";
import { filterEntries } from "@/domain/systems/filters";
import type { SystemEntry } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { useSystemQuery } from "@/lib/use-url-state";
import { BarChart, type Bar } from "./bar-chart";
import type { LegendItem } from "./chart-legend";
import { ExportMenu, type FigureSize } from "./export-menu";
import { GroupLegend } from "./group-legend";
import { categoryColors, groupColors, markerPath, maxGroups, mutedColor, otherColor, swatchPath } from "./markers";
import { PieChart, type Slice } from "./pie-chart";
import { Scatterplot, type PlotPoint } from "./scatterplot";
import { SelectionPanel } from "./selection-panel";

const labelLimit = 24;
const charts = ["scatter", "bar", "pie"] as const;
type Chart = (typeof charts)[number];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-line-strong p-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cx("h-6 rounded-sm px-2.5 capitalize", option === value ? "bg-ink text-white" : "text-muted hover:text-ink")}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Picker({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-muted">
      {label}
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 text-xs text-ink">
        {children}
      </Select>
    </label>
  );
}

const dimensionOptions = dimensions.map((dimension) => (
  <option key={dimension.key} value={dimension.key}>
    {dimension.label}
  </option>
));

const compositionOptions = compositionKinds.map((kind) => (
  <option key={kind.key} value={kind.key}>
    {kind.label}
  </option>
));

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function Explorer({ entries }: { entries: SystemEntry[] }) {
  const { query, setQuery, params, update } = useSystemQuery();
  const facets = useMemo(() => buildFacets(entries), [entries]);
  const visible = useMemo(() => filterEntries(entries, query), [entries, query]);

  const chart: Chart = charts.find((option) => option === params.get("chart")) ?? "scatter";
  const xDimension = findDimension(params.get("x")) ?? findDimension("transformCount")!;
  const yDimension = findDimension(params.get("y")) ?? findDimension("uniqueOperations")!;
  const barComposition = findCompositionKind(params.get("measure"));
  const barDimension = barComposition ? undefined : (findDimension(params.get("measure")) ?? findDimension("transformCount")!);
  const barKey = barComposition?.key ?? barDimension!.key;
  const pieKind = findCompositionKind(params.get("parts")) ?? compositionKinds[0];
  const perSystem = chart === "scatter" || (chart === "bar" && barDimension !== undefined);
  const grouped = perSystem && params.get("view") === "groups";
  const k = Math.min(maxGroups, Math.max(2, Number(params.get("k")) || 3));
  const selectedId = Number(params.get("sel")) || undefined;
  const selected = visible.find((entry) => entry.id === selectedId);
  const filtered = visible.length < entries.length;

  const grouping = useMemo(() => (grouped ? groupSystems(visible, k) : undefined), [grouped, visible, k]);

  const set = (key: string, value: string | undefined) =>
    update((next) => (value === undefined ? next.delete(key) : next.set(key, value)));
  const select = (id: string | number | undefined) => set("sel", id === undefined ? undefined : String(id));

  const points = useMemo(() => {
    const shown = new Set(visible.map((entry) => entry.id));
    return entries.map(
      (entry): PlotPoint => ({
        id: entry.id,
        label: entry.name,
        detail: `${entry.paper.title} (${entry.paper.year})`,
        x: xDimension.value(entry.features),
        y: yDimension.value(entry.features),
        group: grouping?.groupOf.get(entry.id),
        muted: !shown.has(entry.id),
      }),
    );
  }, [entries, visible, xDimension, yDimension, grouping]);

  const bars = useMemo((): Bar[] => {
    if (barComposition) {
      return composition(visible, barComposition).map((part) => ({
        key: part.value,
        label: part.value,
        value: part.count,
        color: categoryColors[0],
      }));
    }
    const dimension = barDimension!;
    return visible
      .map((entry) => ({
        key: String(entry.id),
        label: entry.name,
        detail: `${entry.paper.title} (${entry.paper.year})`,
        value: dimension.value(entry.features),
        color: groupColors[grouping?.groupOf.get(entry.id) ?? 0],
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [visible, barComposition, barDimension, grouping]);

  const slices = useMemo((): Slice[] => {
    const ranked = composition(entries, pieKind).map((part) => part.value).slice(0, categoryColors.length);
    const colorOf = new Map(ranked.map((value, index) => [value, categoryColors[index]]));
    return foldParts(composition(visible, pieKind), new Set(ranked), "Other").map((part) => ({
      key: part.value,
      label: part.value,
      value: part.count,
      color: colorOf.get(part.value) ?? otherColor,
    }));
  }, [entries, visible, pieKind]);

  const groupLegend: LegendItem[] =
    grouping?.groups.map((group) => ({
      label: `Group ${group.index + 1}`,
      color: groupColors[group.index],
      path: chart === "scatter" ? markerPath(group.index, 5) : swatchPath,
    })) ?? [];
  const scatterLegend: LegendItem[] = [
    ...groupLegend,
    ...(filtered
      ? [
          ...(grouping ? [] : [{ label: "Matches filters", color: groupColors[0], path: markerPath(undefined, 5) }]),
          { label: "Filtered out", color: mutedColor, path: markerPath(undefined, 3) },
        ]
      : []),
  ];

  const figure = (size?: FigureSize) => {
    if (chart === "pie") return <PieChart slices={slices} unit={pieKind.unit} size={size} />;
    if (chart === "bar") {
      const dimension = barDimension;
      return (
        <BarChart
          bars={bars}
          valueLabel={dimension?.label ?? capitalize(barComposition!.unit)}
          format={(value) => (dimension ? formatDimensionValue(dimension, value) : String(value))}
          ratio={dimension?.ratio}
          size={size}
          legend={size && groupLegend}
          selectedKey={dimension ? selected && String(selected.id) : undefined}
          onSelect={dimension ? (key) => select(key) : undefined}
        />
      );
    }
    return (
      <Scatterplot
        points={points}
        xDimension={xDimension}
        yDimension={yDimension}
        selectedId={selected?.id}
        onSelect={select}
        showLabels={visible.length <= labelLimit}
        size={size}
        legend={size && scatterLegend}
      />
    );
  };

  const plot = useRef<HTMLDivElement>(null);
  const screenSize = () => {
    const svg = plot.current?.querySelector("svg");
    return svg ? { width: Number(svg.getAttribute("width")), height: Number(svg.getAttribute("height")) } : undefined;
  };
  const filename = [
    "explore",
    chart,
    ...(chart === "scatter" ? [xDimension.key, yDimension.key] : []),
    ...(chart === "bar" ? [barKey] : []),
    ...(chart === "pie" ? [pieKind.key] : []),
    ...(grouping ? [`k${k}`] : []),
  ].join("-");

  return (
    <>
      <FilterBar facets={facets} query={query} onChange={setQuery} resultCount={visible.length} total={entries.length} />

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <Segmented label="Chart" options={charts} value={chart} onChange={(value) => set("chart", value === "scatter" ? undefined : value)} />
        {chart === "scatter" && (
          <>
            <Picker label="X" value={xDimension.key} onChange={(value) => set("x", value)}>
              {dimensionOptions}
            </Picker>
            <Picker label="Y" value={yDimension.key} onChange={(value) => set("y", value)}>
              {dimensionOptions}
            </Picker>
          </>
        )}
        {chart === "bar" && (
          <Picker label="Value" value={barKey} onChange={(value) => set("measure", value)}>
            <optgroup label="Per system">{dimensionOptions}</optgroup>
            <optgroup label="Corpus composition">{compositionOptions}</optgroup>
          </Picker>
        )}
        {chart === "pie" && (
          <Picker label="Parts" value={pieKind.key} onChange={(value) => set("parts", value)}>
            {compositionOptions}
          </Picker>
        )}
        {perSystem && (
          <Segmented
            label="Encoding"
            options={["points", "groups"] as const}
            value={grouped ? "groups" : "points"}
            onChange={(value) => set("view", value === "groups" ? "groups" : undefined)}
          />
        )}
        {grouped && (
          <Picker label="k" value={String(k)} onChange={(value) => set("k", value)}>
            {Array.from({ length: maxGroups - 1 }, (_, index) => index + 2).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Picker>
        )}
        {chart === "scatter" && filtered && (
          <span className="inline-flex items-center gap-1.5 text-faint">
            <span className="size-1.5 rounded-full" style={{ background: mutedColor }} />
            filtered out
          </span>
        )}
        <div className="ml-auto">
          <ExportMenu renderFigure={figure} screenSize={screenSize} filename={filename} />
        </div>
      </div>

      <div className={cx("grid gap-8", perSystem && "grid-cols-[1fr_17rem]")}>
        <div ref={plot} className="min-w-0 border-y border-line py-2">
          {figure()}
        </div>
        {perSystem && (
          <aside className="pt-2">
            <SelectionPanel entry={selected} dimensions={chart === "scatter" ? [xDimension, yDimension] : [barDimension!]} />
          </aside>
        )}
      </div>

      {grouping && <GroupLegend grouping={grouping} entries={visible} />}
    </>
  );
}
