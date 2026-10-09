"use client";

import { useId, useState } from "react";
import { ActorLegend } from "@/components/explore/actor-strip";
import { actorPalette } from "@/components/explore/markers";
import { Section } from "@/components/ui/section";
import { loops } from "@/domain/grammar/features";
import type { Process } from "@/domain/grammar/types";
import type { Flow } from "@/domain/systems/flow";
import { cx } from "@/lib/cx";
import { processAnchor, processNumber } from "@/lib/format";
import { boxHeight, boxWidth, layoutFlow } from "./flow-layout";

const cell = { width: 6, height: 14, gap: 1.5 };
// Room for the strip: the box less its padding (p-2.5) and the number column (1.375rem).
const stripRoom = boxWidth - 2 * 10 - 22;
const loopLift = 9;
const loopStep = 4;

// Loops nest: a loop that spans another is drawn one step higher.
function loopLevels(process: Process) {
  const placed: { step: number; to: number; level: number }[] = [];
  for (const loop of loops(process).sort((a, b) => a.step - a.to - (b.step - b.to))) {
    const below = placed.filter((other) => other.to <= loop.step && loop.to <= other.step);
    placed.push({ ...loop, level: below.length ? Math.max(...below.map((other) => other.level)) + 1 : 0 });
  }
  return placed;
}

function LoopMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 6 6" refX={6} refY={3} markerWidth={4} markerHeight={4} orient="auto">
        <path d="M0,0 L6,3 L0,6 z" className="fill-faint" />
      </marker>
    </defs>
  );
}

function FlowStrip({ process }: { process: Process }) {
  const markerId = useId();
  const count = process.transforms.length;
  // Long strips tighten their spacing, then their cells, to stay inside the box.
  const gap = Math.min(cell.gap, Math.max(1, (stripRoom - count * cell.width) / (count - 1 || 1)));
  const width = Math.min(cell.width, (stripRoom - (count - 1) * gap) / count);
  const cellX = (step: number) => step * (width + gap);
  const center = (step: number) => cellX(step) + width / 2;
  return (
    <svg width={cellX(count) - gap} height={cell.height} className="block shrink-0 overflow-visible" aria-hidden>
      <LoopMarker id={markerId} />
      {process.transforms.map((transform, step) => (
        <g key={step}>
          <title>{`${transform.actor} ${transform.operation}${transform.generative ? " ~" : ""}`}</title>
          <rect x={cellX(step)} width={width} height={cell.height} rx={1} fill={actorPalette[transform.actor]} />
          {transform.generative && <circle cx={center(step)} cy={cell.height / 2} r={1.5} className="fill-white" />}
        </g>
      ))}
      {loopLevels(process).map(({ step, to, level }) => (
        <path
          key={`${step}-${to}`}
          d={`M${center(step)},-1.5 V${-loopLift - level * loopStep} H${center(to)} V-2`}
          fill="none"
          strokeWidth={1}
          markerEnd={`url(#${markerId})`}
          className="stroke-faint"
        />
      ))}
    </svg>
  );
}

export function FlowLegend({ flows }: { flows: Flow[] }) {
  const markerId = useId();
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <ActorLegend />
      <span className="inline-flex items-center gap-1.5">
        <svg width={14} height={11} viewBox="0 -1 14 11" className="overflow-visible" aria-hidden>
          <LoopMarker id={markerId} />
          <path d="M13,10 V1 H2 V9.5" fill="none" strokeWidth={1} markerEnd={`url(#${markerId})`} className="stroke-faint" />
        </svg>
        loop
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width={16} height={6} viewBox="0 0 16 6" aria-hidden>
          <path d="M0,3 H11" strokeWidth={1.25} className="stroke-line-strong" />
          <path d="M10,0 L16,3 L10,6 z" className="fill-line-strong" />
        </svg>
        output starts process
      </span>
      {flows.some((flow) => flow.links.some((link) => link.back)) && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 border-t border-dashed border-line-strong" />
          loops back
        </span>
      )}
    </span>
  );
}

export function FlowDiagram({
  flow,
  names,
  processes,
  anchor = processAnchor,
}: {
  flow: Flow;
  names: (string | null)[];
  processes: (Process | null)[];
  anchor?: (index: number) => string;
}) {
  const markerId = useId();
  const [active, setActive] = useState<number | null>(null);
  const nesting = Math.max(0, ...processes.flatMap((process) => (process ? loopLevels(process).map(({ level }) => level) : [])));
  const { width, height, boxes, strokes, boxHeight: rowHeight } = layoutFlow(flow, boxHeight + nesting * loopStep);
  const related = (index: number) =>
    active === null ||
    index === active ||
    flow.dependencies.some((dep) => (dep.from === active && dep.to === index) || (dep.to === active && dep.from === index));
  const lit = (from: number, to: number) => active !== null && (from === active || to === active);
  // Lit strokes go last so they are drawn over the shared trunks.
  const ordered = [...strokes].sort((a, b) => Number(lit(a.from, a.to)) - Number(lit(b.from, b.to)));

  return (
    <div className="overflow-x-auto border-y border-line py-6">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            {["base", "lit"].map((tone) => (
              <marker key={tone} id={`${markerId}-${tone}`} viewBox="0 0 6 6" refX={6} refY={3} markerWidth={6} markerHeight={6} orient="auto">
                <path d="M0,0 L6,3 L0,6 z" className={tone === "lit" ? "fill-ink" : "fill-line-strong"} />
              </marker>
            ))}
          </defs>
          {ordered.map(({ key, from, to, back, path }) => (
            <path
              key={key}
              d={path}
              fill="none"
              strokeWidth={1.25}
              strokeLinejoin="round"
              strokeDasharray={back ? "4 3" : undefined}
              markerEnd={`url(#${markerId}-${lit(from, to) ? "lit" : "base"})`}
              className={cx("transition-opacity", lit(from, to) ? "stroke-ink" : "stroke-line-strong", active !== null && !lit(from, to) && "opacity-30")}
            />
          ))}
        </svg>
        {boxes.map(({ index, x, y }) => {
          const process = processes[index];
          return (
            <a
              key={index}
              href={`#${anchor(index)}`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              title={names[index] ?? undefined}
              style={{ left: x, top: y, width: boxWidth, height: rowHeight }}
              className={cx(
                "absolute grid grid-cols-[1.375rem_minmax(0,1fr)] rounded border bg-white p-2.5 text-[12px] leading-[16.5px] transition-[opacity,border-color] focus-visible:outline-none",
                index === active ? "border-ink" : "border-line-strong",
                !related(index) && "opacity-30",
              )}
            >
              <span className="font-mono text-[11px] text-faint">{processNumber(index)}</span>
              <span className="flex min-h-0 flex-col justify-between">
                <span className="line-clamp-2 text-ink">{names[index] ?? "Untitled"}</span>
                {process && <FlowStrip process={process} />}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function ProcessFlow({ flow, names, processes }: { flow: Flow; names: (string | null)[]; processes: (Process | null)[] }) {
  if (flow.dependencies.length === 0) return null;
  return (
    <Section title="Process flow" aside={<FlowLegend flows={[flow]} />}>
      <FlowDiagram flow={flow} names={names} processes={processes} />
    </Section>
  );
}
