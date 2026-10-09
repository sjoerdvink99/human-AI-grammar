"use client";

import { useId, useMemo, useState, type MouseEvent } from "react";
import { formatActor, formatType } from "@/domain/grammar/formatter";
import type { GraphNode, ProcessGraph } from "@/domain/grammar/graph";
import { actorKinds, type ActorKind, type Transform } from "@/domain/grammar/types";
import { describeActor } from "@/domain/systems/actors";
import type { ActorCatalog } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { useGraphHighlight } from "./graph-highlight";
import { layoutGraph } from "./graph-layout";

const nodeCharWidth = 7.2;
const labelCharWidth = 6.6;

const stroke: Record<ActorKind, string> = { human: "stroke-human", model: "stroke-model", tool: "stroke-tool" };
const fill: Record<ActorKind, string> = { human: "fill-human", model: "fill-model", tool: "fill-tool" };

const edgeLabel = (transform: Transform) => `${formatActor(transform)} ${transform.operation}${transform.generative ? "~" : ""}`;

const minScale = 0.6;

const nodeWidth = (node: GraphNode) => node.representation.id.length * nodeCharWidth + 20;

const tailLength = (transform: Transform) => edgeLabel(transform).length * labelCharWidth + 16;

function NodeText({ id, faint, x, y }: { id: string; faint: boolean; x: number; y: number }) {
  const match = /^(.*[^_])_([^_]+)$/.exec(id);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className={cx("font-mono text-[12px]", faint ? "fill-faint" : "fill-ink")}>
      {match ? match[1] : id}
      {match && (
        <tspan dy={3} className="text-[9px]">
          {match[2]}
        </tspan>
      )}
    </text>
  );
}

export function GraphView({ graph, actors, fit, place }: { graph: ProcessGraph; actors?: ActorCatalog; fit?: boolean; place?: string }) {
  const markerId = useId();
  // Hovering a representation that recurs, as a carried copy here or in another process, highlights every node of it,
  // so the reader sees where it comes from and where it goes.
  const highlight = useGraphHighlight();
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const showTip = (text: string) => (event: MouseEvent) => setTip({ text, x: event.clientX, y: event.clientY });
  const hideTip = () => setTip(null);
  const active = highlight ? highlight.active : hovered;
  const setActive = highlight?.setActive ?? setHovered;
  const elsewhere = (id: string) => (highlight?.places[id] ?? []).filter((other) => other !== place);
  const copied = new Set(graph.nodes.filter((node) => node.carried).map((node) => node.representation.id));
  const { width, height, boxes, strokes, labels } = useMemo(() => {
    const widths = new Map(graph.nodes.map((node) => [node.key, nodeWidth(node)]));
    return layoutGraph(graph, (key) => widths.get(key)!, (edge) => tailLength(edge.transform));
  }, [graph]);

  return (
    <div className="overflow-x-auto">
      <svg
        width={fit ? "100%" : width}
        height={fit ? undefined : height}
        viewBox={fit ? `0 0 ${width} ${height}` : undefined}
        style={fit ? { maxWidth: width, minWidth: width * minScale } : undefined}
        data-graph
        className="mx-auto block overflow-visible"
      >
        <defs>
          {actorKinds.map((actor) => (
            <marker key={actor} id={`${markerId}-${actor}`} viewBox="0 0 6 6" refX={6} refY={3} markerWidth={6} markerHeight={6} orient="auto">
              <path d="M0,0 L6,3 L0,6 z" className={fill[actor]} />
            </marker>
          ))}
        </defs>
        {strokes.map(({ key, path, transform, arrow }) => (
          <path
            key={key}
            d={path}
            fill="none"
            strokeWidth={1.25}
            strokeDasharray={transform?.generative ? "4 3" : undefined}
            markerEnd={transform && arrow ? `url(#${markerId}-${transform.actor})` : undefined}
            className={transform ? stroke[transform.actor] : "stroke-line-strong"}
          />
        ))}
        {labels.map(({ key, x, y, transform }) => {
          const details = actors?.[formatActor(transform)];
          return (
            <text
              key={key}
              x={x}
              y={y}
              textAnchor="end"
              paintOrder="stroke"
              strokeWidth={4}
              strokeLinejoin="round"
              onMouseMove={details ? showTip(describeActor(details)) : undefined}
              onMouseLeave={details ? hideTip : undefined}
              className={`stroke-white font-mono text-[11px] ${fill[transform.actor]}`}
            >
              {edgeLabel(transform)}
            </text>
          );
        })}
        {graph.nodes.map(({ key, representation, carried }) => {
          const { x, y, width: w, height: h } = boxes.get(key)!;
          const others = elsewhere(representation.id);
          const linked = copied.has(representation.id) || others.length > 0;
          const lit = linked && active === representation.id;
          return (
            <g
              key={key}
              onMouseEnter={linked ? () => setActive(representation.id) : undefined}
              onMouseMove={showTip(`${carried ? "carried over: " : ""}${formatType(representation)}${others.length ? ` · also in ${others.join(", ")}` : ""}`)}
              onMouseLeave={() => {
                hideTip();
                if (linked) setActive(null);
              }}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={4}
                strokeDasharray={carried ? "3 2" : undefined}
                strokeWidth={lit ? 1.5 : 1}
                className={cx("transition-colors", lit ? "fill-accent-wash stroke-accent" : "fill-white stroke-line-strong")}
              />
              <NodeText id={representation.id} faint={!!carried && !lit} x={x + w / 2} y={y + h / 2} />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none fixed z-10 rounded border border-line-strong bg-white px-2 py-1 text-xs shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
          style={{ left: tip.x + 12, top: tip.y + 14 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
