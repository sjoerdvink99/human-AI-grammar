"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { FilterBar } from "@/components/systems/filter-bar";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { pathTo, processTree, treeDetails, treeRoots } from "@/domain/analysis/process-tree";
import { cellKey, flow, flowLevels, grid, motifs, type FlowLevel, type GridKind } from "@/domain/analysis/structure";
import { buildFacets } from "@/domain/systems/facets";
import { filterEntries } from "@/domain/systems/filters";
import type { SystemEntry } from "@/domain/systems/types";
import { useSystemQuery } from "@/lib/use-url-state";
import { ActorLegend } from "./actor-strip";
import { ExportMenu, type FigureSize } from "./export-menu";
import { FlowDiagram, FlowPanel } from "./flow-diagram";
import { GapLegend, GapMatrix, GapPanel, gridCellKey } from "./gap-matrix";
import { MotifList, MotifPanel, motifLimit } from "./motif-list";
import { ProcessStrips, StripPanel, stripSortLabels, stripSorts, systemStrips } from "./process-strips";
import { ProcessTree } from "./process-tree";
import { TreePanel } from "./tree-panel";

const views = ["processes", "motifs", "flow", "gaps", "tree"] as const;
type View = (typeof views)[number];

const motifLengths = ["2", "3", "4"] as const;
const gridKinds: GridKind[] = ["representations", "transformations"];

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
          className={option === value ? "h-6 rounded-sm bg-ink px-2.5 text-white capitalize" : "h-6 rounded-sm px-2.5 text-muted capitalize hover:text-ink"}
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

const detailLabels = { type: "role medium", role: "role", medium: "medium" };

export function Explorer({ entries }: { entries: SystemEntry[] }) {
  const { query, setQuery, params, update } = useSystemQuery();
  const facets = useMemo(() => buildFacets(entries), [entries]);
  const visible = useMemo(() => filterEntries(entries, query), [entries, query]);

  const view: View = views.find((option) => option === params.get("view")) ?? "processes";
  const selected = params.get("sel") ?? undefined;
  const sort = stripSorts.find((option) => option === params.get("sort")) ?? "run";
  const length = motifLengths.find((option) => option === params.get("len")) ?? "3";
  const tools = params.get("tools") === "show";
  const level: FlowLevel = flowLevels.find((option) => option === params.get("level")) ?? "role";
  const detail = treeDetails.find((option) => option === params.get("detail")) ?? "type";

  const set = (key: string, value: string | undefined) =>
    update((next) => (value === undefined ? next.delete(key) : next.set(key, value)));
  const reset = (key: string, value: string | undefined) =>
    update((next) => {
      next.delete("sel");
      next.delete("node");
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    });
  const select = (value: string | undefined) => set("sel", value);

  const strips = useMemo(() => (view === "processes" ? systemStrips(visible, sort) : []), [view, visible, sort]);
  const motifList = useMemo(
    () => (view === "motifs" ? motifs(visible, Number(length), tools).filter((motif) => motif.systems > 1).slice(0, motifLimit) : []),
    [view, visible, length, tools],
  );
  const flowData = useMemo(() => (view === "flow" ? flow(visible, level) : undefined), [view, visible, level]);
  const grids = useMemo(() => (view === "gaps" ? gridKinds.map((kind) => ({ kind, grid: grid(visible, kind) })) : []), [view, visible]);

  const roots = useMemo(() => treeRoots(visible, detail), [visible, detail]);
  const root = roots.find((option) => option === params.get("root"));
  const tree = useMemo(
    () => (view === "tree" && roots.length > 0 ? processTree(visible, root, detail) : undefined),
    [view, visible, roots, root, detail],
  );
  const trail = tree && (pathTo(tree, params.get("node")) ?? [tree]);

  const exportable = view === "flow" || view === "tree";
  const figure = (size?: FigureSize) => {
    if (view === "flow" && flowData) return <FlowDiagram flow={flowData} selectedKey={selected} onSelect={select} size={size} />;
    if (view === "tree" && trail) return <ProcessTree trail={trail} onFocus={(key) => set("node", key)} size={size} />;
    return <EmptyState title="No processes match the filters" />;
  };

  const content = () => {
    if (visible.length === 0) return <EmptyState title="No systems match the filters" />;
    if (view === "processes") return <ProcessStrips rows={strips} selectedId={Number(selected) || undefined} onSelect={(id) => select(id === undefined ? undefined : String(id))} />;
    if (view === "motifs") return <MotifList motifs={motifList} selectedKey={selected} onSelect={select} />;
    if (view === "gaps")
      return (
        <div className="space-y-8 py-2">
          {grids.map(({ kind, grid: data }) => (
            <GapMatrix key={kind} kind={kind} grid={data} selectedKey={selected} onSelect={select} />
          ))}
        </div>
      );
    return figure();
  };

  const panel = () => {
    if (view === "processes") return <StripPanel row={strips.find((row) => String(row.entry.id) === selected)} entries={visible} />;
    if (view === "motifs") return <MotifPanel motif={motifList.find((motif) => motif.key === selected)} entries={visible} />;
    if (view === "flow" && flowData) return <FlowPanel flow={flowData} selectedKey={selected} entries={visible} onSelect={select} />;
    if (view === "gaps") {
      const match = grids.flatMap(({ kind, grid: data }) =>
        data.rows.flatMap((row) => data.columns.flatMap((column) => (gridCellKey(kind, row, column) === selected ? [{ row, column, cell: data.cells.get(cellKey(row, column)) }] : []))),
      )[0];
      return <GapPanel cell={match?.cell} label={match && `${match.row} ${match.column}`} entries={visible} />;
    }
    if (view === "tree" && trail) return <TreePanel node={trail[trail.length - 1]} entries={visible} />;
    return null;
  };

  const plot = useRef<HTMLDivElement>(null);
  const screenSize = () => {
    const svg = plot.current?.querySelector("svg");
    return svg ? { width: Number(svg.getAttribute("width")), height: Number(svg.getAttribute("height")) } : undefined;
  };
  const filename = ["explore", view, ...(view === "flow" ? [level] : []), ...(view === "tree" && trail ? [root?.replaceAll(" ", "_") ?? "all", detail] : [])].join("-");

  return (
    <>
      <FilterBar facets={facets} query={query} onChange={setQuery} resultCount={visible.length} total={entries.length} />

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <Segmented label="View" options={views} value={view} onChange={(value) => reset("view", value === "processes" ? undefined : value)} />
        {view === "processes" && (
          <Picker label="Sort by" value={sort} onChange={(value) => set("sort", value === "run" ? undefined : value)}>
            {stripSorts.map((option) => (
              <option key={option} value={option}>
                {stripSortLabels[option]}
              </option>
            ))}
          </Picker>
        )}
        {view === "motifs" && (
          <>
            <Picker label="Length" value={length} onChange={(value) => reset("len", value === "3" ? undefined : value)}>
              {motifLengths.map((option) => (
                <option key={option} value={option}>
                  {option} steps
                </option>
              ))}
            </Picker>
            <span className="inline-flex items-center gap-2 text-muted">
              Tools
              <Segmented label="Tools" options={["hide", "show"] as const} value={tools ? "show" : "hide"} onChange={(value) => reset("tools", value === "show" ? "show" : undefined)} />
            </span>
          </>
        )}
        {view === "flow" && (
          <Picker label="Detail" value={level} onChange={(value) => reset("level", value === "role" ? undefined : value)}>
            {flowLevels.map((option) => (
              <option key={option} value={option}>
                {detailLabels[option]}
              </option>
            ))}
          </Picker>
        )}
        {view === "tree" && (
          <>
            <Picker label="Root" value={root ?? ""} onChange={(value) => reset("root", value || undefined)}>
              <option value="">All (overview)</option>
              {roots.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Picker>
            <Picker label="Detail" value={detail} onChange={(value) => reset("detail", value === "type" ? undefined : value)}>
              {treeDetails.map((option) => (
                <option key={option} value={option}>
                  {detailLabels[option]}
                </option>
              ))}
            </Picker>
          </>
        )}
        {(view === "processes" || view === "motifs") && <ActorLegend generative={view === "processes"} />}
        {view === "gaps" && <GapLegend />}
        {exportable && (
          <div className="ml-auto">
            <ExportMenu renderFigure={figure} screenSize={screenSize} filename={filename} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_17rem] gap-8">
        <div ref={plot} className="min-w-0 border-y border-line py-2">
          {content()}
        </div>
        <aside className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-y-auto pt-2">{panel()}</aside>
      </div>
    </>
  );
}
