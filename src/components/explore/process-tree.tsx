"use client";

import { Fragment, useMemo, useState, type MouseEvent } from "react";
import type { TreeNode } from "@/domain/analysis/process-tree";
import { actorKinds } from "@/domain/grammar/types";
import { plural } from "@/lib/format";
import { legendHeight, legendRows, SvgLegend } from "./chart-legend";
import { actorPalette, swatchPath } from "./markers";
import { Tooltip } from "./tooltip";
import { headerHeight, layoutTreemap, transformLabel, type Box } from "./treemap-layout";
import { useWidth } from "./use-width";

const defaultHeight = 460;
const charWidth = 6.6;
const endColor = "#8d939d";
const startColor = "#3d4552";

const legendFor = (overview: boolean) => [
  ...(overview ? [{ label: "starts from", color: startColor, path: swatchPath }] : []),
  ...actorKinds.map((actor) => ({ label: actor, color: actorPalette[actor], path: swatchPath })),
  { label: "ends here", color: endColor, path: swatchPath },
];

// Nodes without a transform are the starting representations of the overview.
const colorOf = (node?: TreeNode) => (node ? (node.transform ? actorPalette[node.transform.actor] : startColor) : endColor);
const subtitle = (node: TreeNode) => (node.transform ? transformLabel(node) : "starts from");

// Mixed with white rather than drawn translucent, so nested tiles never blend with the tile beneath.
const tint = (hex: string, amount: number) => {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(255 - (255 - channel) * amount)).join(",")})`;
};

const fit = (text: string, width: number) => {
  const max = Math.floor(width / charWidth);
  return text.length <= max ? text : max > 1 ? `${text.slice(0, max - 1)}…` : "";
};

const typesLabel = (node: TreeNode) => node.types.join(" + ");

function Trail({ trail, onFocus }: { trail: TreeNode[]; onFocus?: (key: string | undefined) => void }) {
  return (
    <nav aria-label="Path" className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1 pb-2.5 text-[13px]">
      {trail.map((node, index) => {
        const current = index === trail.length - 1;
        const label = (
          <>
            {node.transform && (
              <span className="mr-1.5 font-mono text-[11px]" style={{ color: actorPalette[node.transform.actor] }}>
                {transformLabel(node)}
              </span>
            )}
            {typesLabel(node)}
          </>
        );
        return (
          <Fragment key={node.key}>
            {index > 0 && (
              <span className="text-faint" aria-hidden>
                →
              </span>
            )}
            {current ? (
              <span aria-current="location" className="rounded bg-wash px-1.5 py-0.5 font-medium">
                {label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onFocus?.(index === 0 ? undefined : node.key)}
                className="rounded px-1.5 py-0.5 text-muted hover:bg-wash hover:text-ink"
              >
                {label}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export function ProcessTree({
  trail,
  onFocus,
  size,
}: {
  trail: TreeNode[];
  onFocus?: (key: string | undefined) => void;
  size?: { width: number; height: number };
}) {
  const [container, measuredWidth] = useWidth();
  const [hovered, setHovered] = useState<{ box: Box; x: number; y: number }>();
  const interactive = size === undefined;
  const focus = trail[trail.length - 1];
  const width = size?.width ?? measuredWidth;
  const overview = focus.children.some((child) => !child.transform);
  const rows = legendRows(legendFor(overview), width - 24);
  const mapHeight = (size?.height ?? defaultHeight) - (size ? legendHeight(rows) : 0);
  const tiles = useMemo(() => layoutTreemap(focus, { x: 0, y: 0, width, height: mapHeight }), [focus, width, mapHeight]);

  const hover = (box: Box) => (event: MouseEvent) => {
    const bounds = event.currentTarget.closest("svg")!.getBoundingClientRect();
    setHovered({ box, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  return (
    <div className="w-full select-none">
      {interactive && <Trail trail={trail} onFocus={onFocus} />}
      <div ref={container} className="relative" style={{ minHeight: mapHeight }}>
        {width > 0 && (
          <svg
            width={width}
            height={mapHeight + legendHeight(rows)}
            className="block"
            role="img"
            aria-label={overview ? "Treemap of all processes by starting representation" : `Treemap of the processes that continue from ${typesLabel(focus)}`}
            onMouseLeave={() => setHovered(undefined)}
          >
            {tiles.map((tile) => {
              const drillable = interactive && tile.node !== undefined;
              const labelled = tile.width >= 48 && tile.height >= 34;
              const count = String(tile.count);
              const countRoom = tile.width >= 90 ? count.length * charWidth + 8 : 0;
              return (
                <g
                  key={tile.node?.key ?? "end"}
                  {...(interactive && { onMouseMove: hover(tile) })}
                  {...(drillable && { className: "cursor-pointer", onClick: () => onFocus?.(tile.node!.key) })}
                >
                  <rect
                    x={tile.x}
                    y={tile.y}
                    width={tile.width}
                    height={tile.height}
                    rx={3}
                    fill={tint(colorOf(tile.node), hovered?.box === tile && drillable ? 0.22 : 0.13)}
                  />
                  {tile.children.map((child) => (
                    <rect
                      key={child.node!.key}
                      x={child.x}
                      y={child.y}
                      width={child.width}
                      height={child.height}
                      rx={2}
                      fill={tint(colorOf(child.node), 0.36)}
                    />
                  ))}
                  {labelled && (
                    <>
                      <text x={tile.x + 8} y={tile.y + 17} className="fill-ink text-xs font-medium">
                        {fit(tile.node ? typesLabel(tile.node) : "Ends here", tile.width - 16 - countRoom)}
                      </text>
                      {countRoom > 0 && (
                        <text x={tile.x + tile.width - 8} y={tile.y + 17} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                          {count}
                        </text>
                      )}
                      {tile.node && tile.height >= headerHeight && (
                        <text x={tile.x + 8} y={tile.y + 31} className="fill-muted text-[11px]">
                          {fit(subtitle(tile.node), tile.width - 16)}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}
            <SvgLegend rows={rows} x={12} y={mapHeight} />
          </svg>
        )}
        {interactive && hovered && (
          <Tooltip x={hovered.x} y={hovered.y} flip={hovered.x > width - 260}>
            {hovered.box.node ? (
              <>
                <p className="font-medium">{typesLabel(hovered.box.node)}</p>
                <p className={hovered.box.node.transform ? "font-mono text-muted" : "text-muted"}>{subtitle(hovered.box.node)}</p>
              </>
            ) : (
              <p className="font-medium">Ends at {typesLabel(focus)}</p>
            )}
            <p className="mt-1 tabular-nums">
              {plural(hovered.box.count, "process", "processes")} · {Math.round((hovered.box.count / focus.paths.length) * 100)}%
            </p>
            {hovered.box.node && <p className="mt-1 text-faint">Click to follow this branch</p>}
          </Tooltip>
        )}
      </div>
    </div>
  );
}
