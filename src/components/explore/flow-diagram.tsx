"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { Flow, FlowLink } from "@/domain/analysis/structure";
import { actorKinds, type ActorKind } from "@/domain/grammar/types";
import type { SystemEntry } from "@/domain/systems/types";
import { plural } from "@/lib/format";
import { actorPalette } from "./markers";
import { PanelHeading, ProcessList } from "./process-list";
import { Tooltip } from "./tooltip";
import { useWidth } from "./use-width";

const top = 26;
const nodeWidth = 10;
const typeGap = 6;
const actorGap = 30;
const typeColor = "#aab0b9";

export const nodeKey = (side: FlowLink["side"], type: string) => `node:${side}:${type}`;
export const actorKey = (actor: ActorKind) => `actor:${actor}`;

function related(link: FlowLink, key: string | undefined) {
  if (!key) return true;
  if (key === link.key) return true;
  if (key === nodeKey(link.side, link.type)) return true;
  return key === actorKey(link.actor);
}

interface Placed {
  link: FlowLink;
  path: string;
}

function ribbon(x0: number, y0: number, x1: number, y1: number, thickness: number) {
  const middle = (x0 + x1) / 2;
  return `M${x0},${y0}C${middle},${y0} ${middle},${y1} ${x1},${y1}L${x1},${y1 + thickness}C${middle},${y1 + thickness} ${middle},${y0 + thickness} ${x0},${y0 + thickness}Z`;
}

const minSlot = 8;
const labelGap = minSlot + typeGap;

function spread(centers: number[], limit: number) {
  const placed = [...centers];
  for (let index = 1; index < placed.length; index++) placed[index] = Math.max(placed[index], placed[index - 1] + labelGap);
  for (let index = placed.length - 1; index >= 0; index--) {
    const ceiling = index === placed.length - 1 ? limit : placed[index + 1] - labelGap;
    placed[index] = Math.min(placed[index], ceiling);
  }
  return placed;
}

function layout(flow: Flow, width: number, height: number) {
  const labelWidth = Math.min(170, Math.max(90, ...[...flow.inputs, ...flow.outputs].map((type) => type.length * 6.4 + 14)));
  const leftX = labelWidth;
  const rightX = width - labelWidth - nodeWidth;
  const actorX = (width - nodeWidth) / 2;
  const total = (side: FlowLink["side"], match: (link: FlowLink) => boolean) =>
    flow.links.filter((link) => link.side === side && match(link)).reduce((sum, link) => sum + link.count, 0);
  const inTotals = flow.inputs.map((type) => total("in", (link) => link.type === type));
  const outTotals = flow.outputs.map((type) => total("out", (link) => link.type === type));
  const actorIn = actorKinds.map((actor) => total("in", (link) => link.actor === actor));
  const actorOut = actorKinds.map((actor) => total("out", (link) => link.actor === actor));
  const actorSize = actorKinds.map((_, index) => Math.max(actorIn[index], actorOut[index]));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const available = height - top - 8;
  const fitScale = (totals: number[], gap: number, minimum: number) => {
    let scale = (available - gap * (totals.length - 1)) / sum(totals);
    for (let pass = 0; pass < 4; pass++) {
      const small = totals.filter((value) => value * scale < minimum);
      const large = sum(totals.filter((value) => value * scale >= minimum));
      scale = (available - gap * (totals.length - 1) - small.length * minimum) / (large || 1);
    }
    return scale;
  };
  const scale = Math.min(fitScale(inTotals, typeGap, minSlot), fitScale(outTotals, typeGap, minSlot), fitScale(actorSize, actorGap, 0));
  const stack = (sizes: number[], gap: number, minimum: number) => {
    const slots = sizes.map((size) => Math.max(size * scale, minimum));
    const used = sum(slots) + gap * (sizes.length - 1);
    let y = top + (available - used) / 2;
    return slots.map((slot) => {
      const start = y;
      y += slot + gap;
      return start;
    });
  };
  const inY = stack(inTotals, typeGap, minSlot);
  const outY = stack(outTotals, typeGap, minSlot);
  const actorY = stack(actorSize, actorGap, 0);

  const nodes = (types: string[], ys: number[], totals: number[]) => {
    const labels = spread(
      types.map((_, index) => ys[index] + (totals[index] * scale) / 2),
      height - 6,
    );
    return types.map((type, index) => ({ type, y: ys[index], height: totals[index] * scale, label: labels[index] }));
  };

  const typeCursor = new Map<string, number>();
  const actorCursor = new Map<string, number>();
  const placed: Placed[] = [];
  for (const side of ["in", "out"] as const) {
    const types = side === "in" ? flow.inputs : flow.outputs;
    const ys = side === "in" ? inY : outY;
    const links = flow.links
      .filter((link) => link.side === side)
      .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type) || actorKinds.indexOf(a.actor) - actorKinds.indexOf(b.actor));
    for (const link of links) {
      const typeIndex = types.indexOf(link.type);
      const actorIndex = actorKinds.indexOf(link.actor);
      const thickness = Math.max(0.5, link.count * scale);
      const typeOffset = typeCursor.get(`${side}${link.type}`) ?? 0;
      const actorOffset = actorCursor.get(`${side}${link.actor}`) ?? 0;
      typeCursor.set(`${side}${link.type}`, typeOffset + link.count * scale);
      actorCursor.set(`${side}${link.actor}`, actorOffset + link.count * scale);
      const typeTop = ys[typeIndex] + typeOffset;
      const actorTop = actorY[actorIndex] + actorOffset;
      placed.push({
        link,
        path:
          side === "in"
            ? ribbon(leftX + nodeWidth, typeTop, actorX, actorTop, thickness)
            : ribbon(actorX + nodeWidth, actorTop, rightX, typeTop, thickness),
      });
    }
  }

  return {
    leftX,
    rightX,
    actorX,
    placed,
    inputs: nodes(flow.inputs, inY, inTotals),
    outputs: nodes(flow.outputs, outY, outTotals),
    actors: actorKinds.map((actor, index) => ({ actor, y: actorY[index], height: actorSize[index] * scale })),
  };
}

export function FlowDiagram({
  flow,
  selectedKey,
  onSelect,
  size,
}: {
  flow: Flow;
  selectedKey?: string;
  onSelect?: (key: string | undefined) => void;
  size?: { width: number; height: number };
}) {
  const [container, measuredWidth] = useWidth();
  const [hovered, setHovered] = useState<{ key: string; link?: FlowLink; x: number; y: number }>();
  const interactive = size === undefined;
  const width = size?.width ?? measuredWidth;
  const height = size?.height ?? Math.max(440, Math.max(flow.inputs.length, flow.outputs.length) * 20 + top);
  const placed = useMemo(() => (width > 0 ? layout(flow, width, height) : undefined), [flow, width, height]);
  const active = hovered?.key ?? selectedKey;

  const hover = (key: string, link?: FlowLink) => (event: MouseEvent) => {
    const bounds = event.currentTarget.closest("svg")!.getBoundingClientRect();
    setHovered({ key, link, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const handlers = (key: string, link?: FlowLink) =>
    interactive
      ? { onMouseMove: hover(key, link), onClick: () => onSelect?.(key === selectedKey ? undefined : key), className: "cursor-pointer" }
      : {};
  const nodeOpacity = (key: string, match: (link: FlowLink) => boolean) =>
    !active || active === key || flow.links.some((link) => match(link) && related(link, active)) ? 1 : 0.35;

  return (
    <div ref={container} className="relative w-full select-none" style={{ minHeight: height }}>
      {placed && (
        <svg width={width} height={height} className="block" role="img" aria-label="Flow from representation types through actors to representation types" onMouseLeave={() => setHovered(undefined)}>
          <text x={placed.leftX + nodeWidth} y={12} textAnchor="end" className="fill-faint text-[11px]">
            acts on
          </text>
          <text x={placed.rightX} y={12} className="fill-faint text-[11px]">
            produces
          </text>
          {placed.placed.map(({ link, path }) => (
            <path
              key={link.key}
              d={path}
              fill={actorPalette[link.actor]}
              fillOpacity={related(link, active) ? (active ? 0.5 : 0.22) : 0.05}
              {...handlers(link.key, link)}
            />
          ))}
          {placed.inputs.map(({ type, y, height: nodeHeight, label }) => (
            <g key={`in${type}`} opacity={nodeOpacity(nodeKey("in", type), (link) => link.side === "in" && link.type === type)} {...handlers(nodeKey("in", type))}>
              <rect x={placed.leftX} y={y} width={nodeWidth} height={Math.max(1, nodeHeight)} rx={1.5} fill={typeColor} />
              <text x={placed.leftX - 8} y={label} dy="0.32em" textAnchor="end" className="fill-ink text-[12px]">
                {type}
              </text>
            </g>
          ))}
          {placed.outputs.map(({ type, y, height: nodeHeight, label }) => (
            <g key={`out${type}`} opacity={nodeOpacity(nodeKey("out", type), (link) => link.side === "out" && link.type === type)} {...handlers(nodeKey("out", type))}>
              <rect x={placed.rightX} y={y} width={nodeWidth} height={Math.max(1, nodeHeight)} rx={1.5} fill={typeColor} />
              <text x={placed.rightX + nodeWidth + 8} y={label} dy="0.32em" className="fill-ink text-[12px]">
                {type}
              </text>
            </g>
          ))}
          {placed.actors.map(({ actor, y, height: nodeHeight }) => (
            <g key={actor} opacity={nodeOpacity(actorKey(actor), (link) => link.actor === actor)} {...handlers(actorKey(actor))}>
              <rect x={placed.actorX} y={y} width={nodeWidth} height={Math.max(1, nodeHeight)} rx={1.5} fill={actorPalette[actor]} />
              <text x={placed.actorX + nodeWidth / 2} y={y - 7} textAnchor="middle" className="text-[12px] font-medium" fill={actorPalette[actor]}>
                {actor}
              </text>
            </g>
          ))}
        </svg>
      )}
      {interactive && hovered?.link && (
        <Tooltip x={hovered.x} y={hovered.y} flip={hovered.x > width - 260}>
          <p className="font-medium">
            {hovered.link.side === "in" ? `${hovered.link.type} → ${hovered.link.actor}` : `${hovered.link.actor} → ${hovered.link.type}`}
          </p>
          <p className="mt-0.5 text-muted tabular-nums">
            {plural(hovered.link.count, "transformation")} in {plural(hovered.link.refs.length, "process", "processes")}
          </p>
        </Tooltip>
      )}
    </div>
  );
}

function Breakdown({ links, label, onSelect }: { links: FlowLink[]; label: (link: FlowLink) => React.ReactNode; onSelect: (key: string) => void }) {
  return (
    <ul className="space-y-1 text-xs">
      {[...links]
        .sort((a, b) => b.count - a.count)
        .map((link) => (
          <li key={link.key}>
            <button type="button" onClick={() => onSelect(link.key)} className="flex w-full justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-wash">
              <span>{label(link)}</span>
              <span className="text-muted tabular-nums">{link.count}</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

export function FlowPanel({
  flow,
  selectedKey,
  entries,
  onSelect,
}: {
  flow: Flow;
  selectedKey?: string;
  entries: SystemEntry[];
  onSelect: (key: string | undefined) => void;
}) {
  const link = flow.links.find((candidate) => candidate.key === selectedKey);
  if (link) {
    return (
      <div>
        <PanelHeading
          title={link.side === "in" ? `${link.type} → ${link.actor}` : `${link.actor} → ${link.type}`}
          detail={`${plural(link.count, "transformation")} in ${plural(link.refs.length, "process", "processes")}`}
        />
        <ProcessList entries={entries} items={link.refs} />
      </div>
    );
  }
  const node = selectedKey?.match(/^node:(in|out):(.*)$/);
  if (node) {
    const [, side, type] = node;
    return (
      <div>
        <PanelHeading title={type} detail={side === "in" ? "Acted on by" : "Produced by"} />
        <Breakdown links={flow.links.filter((candidate) => candidate.side === side && candidate.type === type)} label={(item) => item.actor} onSelect={onSelect} />
      </div>
    );
  }
  const actor = actorKinds.find((kind) => selectedKey === actorKey(kind));
  if (actor) {
    const links = flow.links.filter((candidate) => candidate.actor === actor);
    return (
      <div className="space-y-4">
        <PanelHeading title={<span style={{ color: actorPalette[actor] }}>{actor}</span>} />
        <div>
          <p className="mb-1.5 text-xs text-muted">Acts on</p>
          <Breakdown links={links.filter((candidate) => candidate.side === "in")} label={(item) => item.type} onSelect={onSelect} />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-muted">Produces</p>
          <Breakdown links={links.filter((candidate) => candidate.side === "out")} label={(item) => item.type} onSelect={onSelect} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-xs text-muted">
      <PanelHeading title="Flow" />
      <p>Each transformation links the representations it acts on, through the actor that performs it, to the representations it produces.</p>
      <p>Acting on means the representations the previous transformation introduced.</p>
      <p>Select a type, an actor, or a band to see the processes behind it.</p>
    </div>
  );
}
