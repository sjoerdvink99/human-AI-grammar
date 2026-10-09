"use client";

import { scaleLinear } from "d3-scale";
import { useState } from "react";
import { legendHeight, legendRows, SvgLegend, type LegendItem } from "./chart-legend";
import { Tooltip } from "./tooltip";
import { useWidth } from "./use-width";

export interface Bar {
  key: string;
  label: string;
  value: number;
  color: string;
  detail?: string;
}

const singleRowHeight = 22;
const lineHeight = 13;
const maxLines = 3;
const barThickness = 14;
const charWidth = 6.6;
const labelPadding = 16;
const margin = { top: 8, right: 24, bottom: 44 };

function truncate(text: string, maxChars: number) {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
}

function wrap(label: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
  return kept.map((line) => truncate(line, maxChars));
}

function barPath(width: number, height: number) {
  const r = Math.min(3, width, height / 2);
  return `M0,0h${width - r}a${r},${r} 0 0 1 ${r},${r}v${height - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${r - width}z`;
}

export function BarChart({
  bars,
  valueLabel,
  format,
  ratio = false,
  size,
  legend = [],
  selectedKey,
  onSelect,
}: {
  bars: Bar[];
  valueLabel: string;
  format: (value: number) => string;
  ratio?: boolean;
  size?: { width: number };
  legend?: LegendItem[];
  selectedKey?: string;
  onSelect?: (key: string | undefined) => void;
}) {
  const [container, measuredWidth] = useWidth();
  const [hovered, setHovered] = useState<string>();
  const interactive = size === undefined;
  const width = size?.width ?? measuredWidth;

  const longest = Math.max(0, ...bars.map((bar) => bar.label.length));
  const labelWidth = Math.min(longest * charWidth + labelPadding, width * 0.4);
  const maxChars = Math.floor((labelWidth - labelPadding) / charWidth);
  const labels = bars.map((bar) => wrap(bar.label, maxChars));
  const rowHeights = labels.map((lines) => Math.max(singleRowHeight, lines.length * lineHeight + 9));
  const rowTops = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height, 0));
  const innerWidth = Math.max(0, width - labelWidth - margin.right);
  const innerHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const plotHeight = margin.top + innerHeight + margin.bottom;
  const rows = legendRows(legend, width - labelWidth - margin.right);
  const height = plotHeight + legendHeight(rows);

  const x = scaleLinear()
    .domain([0, ratio ? 1 : Math.max(1, ...bars.map((bar) => bar.value))])
    .range([0, innerWidth])
    .nice();
  const ticks = x.ticks(innerWidth < 300 ? 4 : 6).filter((tick) => ratio || Number.isInteger(tick));
  const hoveredIndex = bars.findIndex((bar) => bar.key === hovered);
  const hoveredBar = bars[hoveredIndex];

  return (
    <div ref={container} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block" role="img" aria-label={`${valueLabel} per bar`}>
          <g transform={`translate(${labelWidth},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(${x(tick)},0)`}>
                <line y2={innerHeight} stroke="#eef0f2" />
                <text y={innerHeight + 18} textAnchor="middle" className="fill-faint text-[11px] tabular-nums">
                  {format(tick)}
                </text>
              </g>
            ))}
            <line y2={innerHeight} stroke="#c9cdd3" />
            <text x={innerWidth} y={innerHeight + 38} textAnchor="end" className="fill-muted text-xs">
              {valueLabel} →
            </text>

            {bars.map((bar, index) => {
              const selected = bar.key === selectedKey;
              const rowHeight = rowHeights[index];
              return (
                <g
                  key={bar.key}
                  transform={`translate(0,${rowTops[index]})`}
                  {...(interactive && {
                    className: onSelect ? "cursor-pointer" : undefined,
                    onMouseEnter: () => setHovered(bar.key),
                    onMouseLeave: () => setHovered(undefined),
                    onClick: () => onSelect?.(selected ? undefined : bar.key),
                  })}
                >
                  {interactive && <rect x={-labelWidth} width={labelWidth + innerWidth} height={rowHeight} fill={hovered === bar.key ? "#f6f7f8" : "transparent"} />}
                  <path
                    d={barPath(x(bar.value), barThickness)}
                    transform={`translate(0,${(rowHeight - barThickness) / 2})`}
                    fill={bar.color}
                    opacity={selectedKey === undefined || selected ? 1 : 0.55}
                  />
                  <text
                    x={-10}
                    y={rowHeight / 2 - ((labels[index].length - 1) * lineHeight) / 2}
                    textAnchor="end"
                    className={selected ? "fill-ink text-xs font-medium" : "fill-muted text-[11px]"}
                  >
                    {labels[index].map((line, lineIndex) => (
                      <tspan key={lineIndex} x={-10} dy={lineIndex === 0 ? "0.32em" : lineHeight}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
          <SvgLegend rows={rows} x={labelWidth} y={plotHeight} />
        </svg>
      )}
      {interactive && hoveredBar && (
        <Tooltip
          x={labelWidth + x(hoveredBar.value)}
          y={margin.top + rowTops[hoveredIndex] + rowHeights[hoveredIndex] / 2}
          flip={labelWidth + x(hoveredBar.value) > width - 260}
        >
          <p className="font-medium">{hoveredBar.label}</p>
          {hoveredBar.detail && <p className="truncate text-muted">{hoveredBar.detail}</p>}
          <p className="mt-1 tabular-nums">
            <span className="text-muted">{valueLabel}</span> {format(hoveredBar.value)}
          </p>
        </Tooltip>
      )}
    </div>
  );
}
