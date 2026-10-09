import type { Region } from "../../../shared/types";

export function RegionSummary({ region }: { region: Region | null }) {
  if (!region) return <p className="hint">Drag a rectangle on the simulation to select a region.</p>;
  const nodes = [...new Set(region.elements.map((e) => e.ui_node).filter(Boolean))];
  return (
    <p className="small">
      Region {region.w}×{region.h} at ({region.x}, {region.y}) · {region.elements.length} element(s)
      {nodes.length > 0 && <> · tagged nodes: {nodes.map((n) => <code key={n}>{n} </code>)}</>}
    </p>
  );
}
