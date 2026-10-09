"use client";

import { scaleLinear } from "d3-scale";
import { useMemo, useState } from "react";
import { formatDimensionValue, type Dimension } from "@/domain/systems/dimensions";
import { legendHeight, legendRows, SvgLegend, type LegendItem } from "./chart-legend";
import { groupColors, markerPath, mutedColor } from "./markers";
import { Tooltip } from "./tooltip";
import { useWidth } from "./use-width";

export interface PlotPoint {
  id: number;
  label: string;
  detail: string;
  x: number;
  y: number;
  group?: number;
  muted?: boolean;
}

const defaultHeight = 460;
const margin = { top: 16, right: 24, bottom: 44, left: 52 };
const radius = 5;
const charWidth = 6.6;

function scaleFor(dimension: Dimension, values: number[], range: [number, number]) {
  const max = dimension.ratio ? 1 : Math.max(1, ...values) * 1.1;
  return scaleLinear().domain([0, max]).range(range).nice();
}

function spread<T extends PlotPoint>(points: T[]): (T & { dx: number; dy: number })[] {
  const stacks = new Map<string, T[]>();
  for (const point of points) {
    const key = `${point.x}:${point.y}`;
    stacks.set(key, [...(stacks.get(key) ?? []), point]);
  }
  return [...stacks.values()].flatMap((stack) =>
    stack.map((point, index) => {
      if (stack.length === 1) return { ...point, dx: 0, dy: 0 };
      const angle = (2 * Math.PI * index) / stack.length - Math.PI / 2;
      const ring = radius * 1.6 + stack.length * 0.6;
      return { ...point, dx: Math.cos(angle) * ring, dy: Math.sin(angle) * ring };
    }),
  );
}

export function Scatterplot({
  points,
  xDimension,
  yDimension,
  selectedId,
  onSelect,
  showLabels,
  size,
  legend = [],
}: {
  points: PlotPoint[];
  xDimension: Dimension;
  yDimension: Dimension;
  selectedId?: number;
  onSelect: (id: number | undefined) => void;
  showLabels: boolean;
  size?: { width: number; height: number };
  legend?: LegendItem[];
}) {
  const [container, measuredWidth] = useWidth();
  const [hovered, setHovered] = useState<number>();
  const interactive = size === undefined;
  const width = size?.width ?? measuredWidth;
  const height = size?.height ?? defaultHeight;
  const rows = legendRows(legend, width - margin.left - margin.right);
  const svgHeight = height + legendHeight(rows);
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;

  const x = useMemo(
    () => scaleFor(xDimension, points.map((point) => point.x), [0, innerWidth]),
    [xDimension, points, innerWidth],
  );
  const y = useMemo(
    () => scaleFor(yDimension, points.map((point) => point.y), [innerHeight, 0]),
    [yDimension, points, innerHeight],
  );
  const placed = useMemo(() => spread(points.filter((point) => !point.muted)), [points]);
  const muted = points.filter((point) => point.muted);
  const ticks = (scale: typeof x, dimension: Dimension) =>
    scale.ticks(6).filter((tick) => dimension.ratio || Number.isInteger(tick));
  const hoveredPoint = placed.find((point) => point.id === hovered);

  return (
    <div ref={container} className="relative w-full select-none" style={{ height: svgHeight }}>
      {width > 0 && (
        <svg width={width} height={svgHeight} className="block" onClick={interactive ? () => onSelect(undefined) : undefined} role="img" aria-label={`${yDimension.label} by ${xDimension.label}`}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks(y, yDimension).map((tick) => (
              <g key={`y${tick}`} transform={`translate(0,${y(tick)})`}>
                <line x2={innerWidth} stroke="#eef0f2" />
                <text x={-10} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tabular-nums">
                  {formatDimensionValue(yDimension, tick)}
                </text>
              </g>
            ))}
            {ticks(x, xDimension).map((tick) => (
              <g key={`x${tick}`} transform={`translate(${x(tick)},0)`}>
                <line y2={innerHeight} stroke="#eef0f2" />
                <text y={innerHeight + 18} textAnchor="middle" className="fill-faint text-[11px] tabular-nums">
                  {formatDimensionValue(xDimension, tick)}
                </text>
              </g>
            ))}
            <line y1={innerHeight} y2={innerHeight} x2={innerWidth} stroke="#c9cdd3" />
            <line y2={innerHeight} stroke="#c9cdd3" />
            <text x={innerWidth} y={innerHeight + 38} textAnchor="end" className="fill-muted text-xs">
              {xDimension.label} →
            </text>
            <text transform={`translate(${-40},0) rotate(-90)`} textAnchor="end" className="fill-muted text-xs">
              {yDimension.label} →
            </text>

            {muted.map((point) => (
              <circle key={`m${point.id}`} cx={x(point.x)} cy={y(point.y)} r={3} fill={mutedColor} />
            ))}

            {placed.map((point) => {
              const selected = point.id === selectedId;
              const cx = x(point.x) + point.dx;
              const cy = y(point.y) + point.dy;
              const color = point.group === undefined ? "#2a78d6" : groupColors[point.group];
              const offset = selected ? radius + 10 : radius + 6;
              const labelWidth = point.label.length * charWidth;
              const overflowsRight = cx + offset + labelWidth > innerWidth + margin.right;
              const fitsLeft = cx - offset - labelWidth >= -margin.left;
              const anchorEnd = overflowsRight && (fitsLeft || cx > innerWidth / 2);
              return (
                <g
                  key={point.id}
                  transform={`translate(${cx},${cy})`}
                  {...(interactive && {
                    className: "cursor-pointer",
                    onMouseEnter: () => setHovered(point.id),
                    onMouseLeave: () => setHovered(undefined),
                    onClick: (event: React.MouseEvent) => {
                      event.stopPropagation();
                      onSelect(selected ? undefined : point.id);
                    },
                  })}
                >
                  {interactive && <circle r={12} fill="transparent" />}
                  {selected && <circle r={radius + 5} fill="none" stroke="#15181d" strokeWidth={1.5} />}
                  <path
                    d={markerPath(point.group, selected ? radius + 1 : radius)}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={2}
                    paintOrder="stroke"
                    opacity={selectedId === undefined || selected ? 1 : 0.55}
                  />
                  {(showLabels || selected) && (
                    <text
                      x={anchorEnd ? -offset : offset}
                      dy="0.32em"
                      textAnchor={anchorEnd ? "end" : "start"}
                      className={selected ? "fill-ink text-xs font-medium" : "fill-muted text-[11px]"}
                    >
                      {point.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <SvgLegend rows={rows} x={margin.left} y={height} />
        </svg>
      )}
      {interactive && hoveredPoint && (
        <Tooltip
          x={margin.left + x(hoveredPoint.x) + hoveredPoint.dx}
          y={margin.top + y(hoveredPoint.y) + hoveredPoint.dy}
          flip={margin.left + x(hoveredPoint.x) > width - 260}
        >
          <p className="font-medium">{hoveredPoint.label}</p>
          <p className="truncate text-muted">{hoveredPoint.detail}</p>
          <p className="mt-1 tabular-nums">
            <span className="text-muted">{xDimension.label}</span> {formatDimensionValue(xDimension, hoveredPoint.x)}
          </p>
          <p className="tabular-nums">
            <span className="text-muted">{yDimension.label}</span> {formatDimensionValue(yDimension, hoveredPoint.y)}
          </p>
        </Tooltip>
      )}
    </div>
  );
}
