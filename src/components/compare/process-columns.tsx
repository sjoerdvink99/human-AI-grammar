"use client";

import { ChevronDown, ChevronUp, GripVertical, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { Emphasis } from "@/components/grammar/expression";
import { FlowDiagram, FlowLegend } from "@/components/grammar/process-flow";
import { GraphView } from "@/components/grammar/graph-view";
import { ExportButton } from "@/components/grammar/graph-export";
import { GraphHighlight } from "@/components/grammar/graph-highlight";
import { ExpressionTip } from "@/components/grammar/overview";
import { ParseErrorView } from "@/components/grammar/parse-error-view";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { processGraph, representationPlaces } from "@/domain/grammar/graph";
import { flow } from "@/domain/systems/flow";
import type { SystemEntry } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { processAnchor, processNumber } from "@/lib/format";

type Slots = (number | null)[];

const Graph = memo(GraphView);

const anchorFor = (entry: SystemEntry) => (index: number) => `${entry.id}-${processAnchor(index)}`;

const trimmed = (slots: Slots) => slots.slice(0, slots.findLastIndex((slot) => slot !== null) + 1);

export function ProcessFlows({ entries }: { entries: SystemEntry[] }) {
  const flows = useMemo(() => entries.map((entry) => flow(entry.processes.map(({ result }) => (result.ok ? result.process : null)))), [entries]);

  return (
    <Section title="Process flow" aside={<FlowLegend flows={flows} />}>
      <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
        {entries.map((entry, index) => (
          <div key={entry.id} className="min-w-0">
            <p className="mb-1 text-[13px] font-semibold">{entry.name}</p>
            {flows[index].dependencies.length ? (
              <FlowDiagram flow={flows[index]} names={entry.processes.map(({ name }) => name)} anchor={anchorFor(entry)} />
            ) : (
              <p className="border-y border-line py-6 text-center text-xs text-faint">The processes are independent of each other</p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ProcessColumns({ entries, emphasis }: { entries: SystemEntry[]; emphasis: (index: number) => Emphasis }) {
  const [moved, setMoved] = useState<Record<number, Slots>>({});
  const [grabbed, setGrabbed] = useState<{ system: number; slot: number } | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const graphs = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry.processes.map(({ result }) => (result.ok ? processGraph([result.process]) : null))])),
    [entries],
  );
  const places = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.id,
          representationPlaces(graphs.get(entry.id)!.flatMap((graph, index) => (graph ? [{ place: processNumber(index), graph }] : []))),
        ]),
      ),
    [entries, graphs],
  );

  const columns = entries.map((entry) => trimmed(moved[entry.id] ?? entry.processes.map((_, index) => index)));
  const rows = Math.max(...columns.map((slots) => slots.length));
  const slotsOf = (column: number) => Array.from({ length: rows }, (_, row) => columns[column][row] ?? null);
  const swap = (column: number, from: number, to: number) => {
    const slots = slotsOf(column);
    [slots[from], slots[to]] = [slots[to], slots[from]];
    setMoved((current) => ({ ...current, [entries[column].id]: slots }));
  };
  const drop = (column: number, row: number) => {
    if (grabbed?.system === column && grabbed.slot !== row) swap(column, grabbed.slot, row);
    setGrabbed(null);
    setTarget(null);
  };

  return (
    <Section
      title="Grammar processes"
      aside={
        <span className="flex items-center gap-3">
          Drag a process, or use its arrows, to line it up with one in another system
          {Object.keys(moved).length > 0 && (
            <Button variant="ghost" className="h-6 px-2 text-xs" onClick={() => setMoved({})}>
              <RotateCcw className="size-3" />
              Reset order
            </Button>
          )}
        </span>
      }
    >
      <div
        className="grid gap-x-6 border-t border-line"
        style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))`, gridTemplateRows: `auto repeat(${rows}, auto)` }}
      >
        {entries.map((entry, column) => (
          <p key={entry.id} className="border-b border-line py-2 text-[13px] font-semibold" style={{ gridColumn: column + 1, gridRow: 1 }}>
            {entry.name}
          </p>
        ))}
        {entries.map((entry, column) => (
          <GraphHighlight key={entry.id} places={places.get(entry.id)!}>
            {slotsOf(column).map((index, row) => {
              const process = index === null ? null : entry.processes[index];
              const dragging = grabbed?.system === column;
              return (
                <div
                  key={`${entry.id}-${index ?? `empty-${row}`}`}
                  id={index === null ? undefined : anchorFor(entry)(index)}
                  style={{ gridColumn: column + 1, gridRow: row + 2 }}
                  data-graph-card
                  draggable={process !== null}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setGrabbed({ system: column, slot: row });
                  }}
                  onDragEnd={() => {
                    setGrabbed(null);
                    setTarget(null);
                  }}
                  onDragOver={(event) => {
                    if (!dragging) return;
                    event.preventDefault();
                    setTarget(row);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    drop(column, row);
                  }}
                  className={cx(
                    "relative min-w-0 scroll-mt-6 border-b border-line py-4 transition-colors",
                    dragging && target === row && "bg-accent-wash",
                    dragging && grabbed.slot === row && "opacity-40",
                  )}
                >
                  {process && index !== null ? (
                    <>
                      <div className="mb-3 flex items-center gap-1.5">
                        <GripVertical className="size-3.5 shrink-0 cursor-grab text-faint" />
                        <span className="min-w-0 truncate font-mono text-xs text-faint" title={process.name ?? undefined}>
                          {processNumber(index)}
                          {process.name && <span className="font-sans"> {process.name}</span>}
                        </span>
                        {process.result.ok && (
                          <ExpressionTip
                            process={process.result.process}
                            actors={entry.actors}
                            emphasis={emphasis(column)}
                            align={column < entries.length / 2 ? "left" : "right"}
                          />
                        )}
                        {process.result.ok && <ExportButton fileName={`${entry.paper.citationKey}-process-${processNumber(index)}.png`} />}
                        <span className="ml-auto flex shrink-0">
                          <button
                            type="button"
                            aria-label="Move up"
                            disabled={row === 0}
                            onClick={() => swap(column, row, row - 1)}
                            className="rounded p-0.5 text-faint hover:text-ink disabled:opacity-30"
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            disabled={row === rows - 1}
                            onClick={() => swap(column, row, row + 1)}
                            className="rounded p-0.5 text-faint hover:text-ink disabled:opacity-30"
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                        </span>
                      </div>
                      {process.result.ok ? (
                        <Graph graph={graphs.get(entry.id)![index]!} actors={entry.actors} place={processNumber(index)} fit />
                      ) : (
                        <ParseErrorView source={process.rawExpression} error={process.result.error} />
                      )}
                    </>
                  ) : (
                    dragging && <p className="py-4 text-center text-xs text-faint">Drop here</p>
                  )}
                </div>
              );
            })}
          </GraphHighlight>
        ))}
      </div>
    </Section>
  );
}
