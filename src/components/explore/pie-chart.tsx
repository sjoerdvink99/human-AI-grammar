"use client";

import { useState } from "react";
import { Tooltip } from "./tooltip";
import { useWidth } from "./use-width";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

const defaultHeight = 340;
const pad = 12;
const legendRowHeight = 20;
const legendGap = 28;
const charWidth = 6.6;
const numberColumn = 40;

function point(cx: number, cy: number, r: number, angle: number) {
  return `${cx + r * Math.sin(angle)},${cy - r * Math.cos(angle)}`;
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number) {
  if (end - start >= 2 * Math.PI - 1e-9) {
    return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0z`;
  }
  const large = end - start > Math.PI ? 1 : 0;
  return `M${cx},${cy}L${point(cx, cy, r, start)}A${r},${r} 0 ${large} 1 ${point(cx, cy, r, end)}z`;
}

function percent(value: number, total: number) {
  const share = (value / total) * 100;
  return share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
}

export function PieChart({
  slices,
  unit,
  size,
}: {
  slices: Slice[];
  unit: string;
  size?: { width: number; height: number };
}) {
  const [container, measuredWidth] = useWidth();
  const [hovered, setHovered] = useState<string>();
  const interactive = size === undefined;
  const width = size?.width ?? measuredWidth;
  const baseHeight = size?.height ?? defaultHeight;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  const legendLabelWidth = Math.max(0, ...slices.map((slice) => slice.label.length)) * charWidth;
  const legendWidth = 18 + legendLabelWidth + 2 * numberColumn;
  const legendBlock = slices.length * legendRowHeight;
  const sideRadius = Math.min((baseHeight - 2 * pad) / 2, (width - legendWidth - legendGap - 2 * pad) / 2);
  const side = sideRadius >= Math.min(90, (baseHeight - 2 * pad) / 2);
  const radius = side ? sideRadius : Math.max(0, Math.min((baseHeight - 2 * pad) / 2, (width - 2 * pad) / 2, 110));
  const sideOffset = Math.max(pad, (width - (2 * radius + legendGap + legendWidth)) / 2);
  const cx = side ? sideOffset + radius : width / 2;
  const cy = side ? Math.max(baseHeight, legendBlock + 2 * pad) / 2 : pad + radius;
  const legendX = side ? cx + radius + legendGap : Math.max(pad, (width - legendWidth) / 2);
  const legendY = side ? cy - legendBlock / 2 : cy + radius + pad + 8;
  const height = side ? Math.max(baseHeight, legendBlock + 2 * pad) : legendY + legendBlock + pad;

  let angle = 0;
  const arcs = slices.map((slice) => {
    const start = angle;
    angle += total > 0 ? (slice.value / total) * 2 * Math.PI : 0;
    return { ...slice, start, end: angle };
  });
  const hoveredArc = arcs.find((arc) => arc.key === hovered);
  const dim = (key: string) => (hovered === undefined || hovered === key ? 1 : 0.45);

  return (
    <div ref={container} className="relative w-full select-none" style={{ height }}>
      {width > 0 && total > 0 && (
        <svg width={width} height={height} className="block" role="img" aria-label={`Share of ${unit}`}>
          {arcs.map((arc) => (
            <path
              key={arc.key}
              d={slicePath(cx, cy, radius, arc.start, arc.end)}
              fill={arc.color}
              stroke="#ffffff"
              strokeWidth={arcs.length > 1 ? 2 : 0}
              strokeLinejoin="round"
              opacity={dim(arc.key)}
              {...(interactive && {
                onMouseEnter: () => setHovered(arc.key),
                onMouseLeave: () => setHovered(undefined),
              })}
            />
          ))}
          <g transform={`translate(${legendX},${legendY})`}>
            {arcs.map((arc, index) => (
              <g
                key={arc.key}
                transform={`translate(0,${index * legendRowHeight + legendRowHeight / 2})`}
                opacity={dim(arc.key)}
                {...(interactive && {
                  onMouseEnter: () => setHovered(arc.key),
                  onMouseLeave: () => setHovered(undefined),
                })}
              >
                <rect y={-5} width={10} height={10} rx={2} fill={arc.color} />
                <text x={18} dy="0.32em" className="fill-ink text-[11px]">
                  {arc.label}
                </text>
                <text x={18 + legendLabelWidth + numberColumn} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {arc.value}
                </text>
                <text x={legendWidth} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {percent(arc.value, total)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
      {interactive && hoveredArc && (
        <Tooltip
          x={cx + radius * 0.6 * Math.sin((hoveredArc.start + hoveredArc.end) / 2)}
          y={cy - radius * 0.6 * Math.cos((hoveredArc.start + hoveredArc.end) / 2)}
          flip={false}
        >
          <p className="font-medium">{hoveredArc.label}</p>
          <p className="tabular-nums text-muted">
            {hoveredArc.value} {unit} · {percent(hoveredArc.value, total)}
          </p>
        </Tooltip>
      )}
    </div>
  );
}
