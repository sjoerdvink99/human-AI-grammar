import { cellKey, type Grid, type GridCell, type GridKind } from "@/domain/analysis/structure";
import type { SystemEntry } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { plural } from "@/lib/format";
import { PanelHeading, ProcessList } from "./process-list";

export const rareLimit = 3;

const shade = (systems: number, max: number) => {
  const amount = 0.12 + 0.88 * (Math.log(systems + 1) / Math.log(max + 1));
  const channel = (value: number) => Math.round(255 - (255 - value) * amount);
  return `rgb(${channel(31)},${channel(91)},${channel(198)})`;
};

export const gridTitles: Record<GridKind, { title: string; rows: string; columns: string }> = {
  representations: { title: "Representations", rows: "role", columns: "medium" },
  transformations: { title: "Transformations", rows: "actor", columns: "operation" },
};

export const gridCellKey = (kind: GridKind, row: string, column: string) => `${kind}:${cellKey(row, column)}`;

export function GapMatrix({ kind, grid, selectedKey, onSelect }: { kind: GridKind; grid: Grid; selectedKey?: string; onSelect: (key: string | undefined) => void }) {
  const max = Math.max(1, ...[...grid.cells.values()].map((cell) => cell.systems));
  const { title, rows, columns } = gridTitles[kind];
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-medium">
        {title} <span className="font-normal text-faint">
          {rows} × {columns}
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th />
              {grid.columns.map((column) => (
                <th key={column} className="relative h-16 w-12 min-w-12 p-0 font-normal text-muted">
                  <span className="absolute bottom-1.5 left-1/2 origin-bottom-left -rotate-45 whitespace-nowrap">{column}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row}>
                <th className="pr-2 text-right font-normal whitespace-nowrap text-muted">{row}</th>
                {grid.columns.map((column) => {
                  const cell = grid.cells.get(cellKey(row, column));
                  const key = gridCellKey(kind, row, column);
                  const selected = key === selectedKey;
                  const rare = cell !== undefined && cell.systems <= rareLimit;
                  return (
                    <td key={column} className="p-0">
                      <button
                        type="button"
                        title={`${row} ${column}: ${cell ? plural(cell.systems, "system") : "not in corpus"}`}
                        onClick={() => onSelect(selected ? undefined : key)}
                        className={cx(
                          "block h-7 w-12 rounded-sm tabular-nums",
                          cell ? (cell.systems / max > 0.45 ? "text-white" : "text-ink") : "border border-dashed border-line-strong text-faint",
                          rare && "ring-1 ring-human ring-inset",
                          selected && "outline-2 outline-offset-1 outline-ink",
                        )}
                        style={cell ? { background: shade(cell.systems, max) } : undefined}
                      >
                        {cell ? cell.systems : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function GapLegend() {
  return (
    <span className="inline-flex items-center gap-3 text-faint">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm" style={{ background: shade(40, 160) }} />
        systems
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm ring-1 ring-human ring-inset" />
        {rareLimit} or fewer
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm border border-dashed border-line-strong" />
        not in corpus
      </span>
    </span>
  );
}

export function GapPanel({ cell, label, entries }: { cell?: GridCell; label?: string; entries: SystemEntry[] }) {
  if (!label) {
    return (
      <div className="space-y-2 text-xs text-muted">
        <PanelHeading title="Gaps" />
        <p>Each cell counts the systems that combine a role with a medium, or an actor with an operation.</p>
        <p>Empty and rare cells are combinations the grammar can express but the corpus barely uses.</p>
        <p>Select a cell to see the processes behind it.</p>
      </div>
    );
  }
  if (!cell) {
    return (
      <div className="space-y-2 text-xs text-muted">
        <PanelHeading title={label} detail="Not in corpus" />
        <p>No system in the corpus uses this combination. It marks a design the grammar can express that current systems do not explore.</p>
      </div>
    );
  }
  return (
    <div>
      <PanelHeading title={label} detail={`${plural(cell.systems, "system")} · ${plural(cell.refs.length, "process", "processes")}`} />
      <ProcessList entries={entries} items={cell.refs} />
    </div>
  );
}
