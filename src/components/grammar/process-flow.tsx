"use client";

import { useId, useState } from "react";
import { Section } from "@/components/ui/section";
import type { Flow } from "@/domain/systems/flow";
import { cx } from "@/lib/cx";
import { processAnchor, processNumber } from "@/lib/format";
import { boxHeight, boxWidth, layoutFlow } from "./flow-layout";

export function FlowLegend({ flows }: { flows: Flow[] }) {
  return (
    <span className="flex gap-3">
      <span className="flex items-center gap-1.5">
        <span className="h-px w-3 bg-line-strong" />
        output starts process
      </span>
      {flows.some((flow) => flow.links.some((link) => link.back)) && (
        <span className="flex items-center gap-1.5">
          <span className="w-3 border-t border-dashed border-line-strong" />
          loops back
        </span>
      )}
    </span>
  );
}

export function FlowDiagram({ flow, names, anchor = processAnchor }: { flow: Flow; names: (string | null)[]; anchor?: (index: number) => string }) {
  const markerId = useId();
  const [active, setActive] = useState<number | null>(null);
  const { width, height, boxes, strokes } = layoutFlow(flow);
  const related = (index: number) =>
    active === null ||
    index === active ||
    flow.dependencies.some((dep) => (dep.from === active && dep.to === index) || (dep.to === active && dep.from === index));
  const lit = (from: number, to: number) => active !== null && (from === active || to === active);

  return (
    <div className="overflow-x-auto border-y border-line py-6">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0 overflow-visible">
          <defs>
            {["base", "lit"].map((tone) => (
              <marker key={tone} id={`${markerId}-${tone}`} viewBox="0 0 6 6" refX={6} refY={3} markerWidth={6} markerHeight={6} orient="auto">
                <path d="M0,0 L6,3 L0,6 z" className={tone === "lit" ? "fill-ink" : "fill-line-strong"} />
              </marker>
            ))}
          </defs>
          {strokes.map(({ key, from, to, back, path }) => (
            <path
              key={key}
              d={path}
              fill="none"
              strokeWidth={1.25}
              strokeDasharray={back ? "4 3" : undefined}
              markerEnd={`url(#${markerId}-${lit(from, to) ? "lit" : "base"})`}
              className={cx("transition-opacity", lit(from, to) ? "stroke-ink" : "stroke-line-strong", active !== null && !lit(from, to) && "opacity-30")}
            />
          ))}
        </svg>
        {boxes.map(({ index, x, y }) => (
          <a
            key={index}
            href={`#${anchor(index)}`}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            title={names[index] ?? undefined}
            style={{ left: x, top: y, width: boxWidth, height: boxHeight }}
            className={cx(
              "absolute flex items-start gap-1.5 rounded border bg-white px-2 py-1.5 text-[12px] leading-snug transition-opacity focus-visible:outline-none",
              index === active ? "border-ink" : "border-line-strong",
              !related(index) && "opacity-30",
            )}
          >
            <span className="font-mono text-[11px] text-faint">{processNumber(index)}</span>
            <span className="line-clamp-2">{names[index] ?? "Untitled"}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function ProcessFlow({ flow, names }: { flow: Flow; names: (string | null)[] }) {
  if (flow.dependencies.length === 0) return null;
  return (
    <Section title="Process flow" aside={<FlowLegend flows={[flow]} />}>
      <FlowDiagram flow={flow} names={names} />
    </Section>
  );
}
