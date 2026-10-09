import { useMemo } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface GNode {
  id: string;
  label: string;
  group: string;
  title?: string;
}
export interface GEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  dashed?: boolean;
}

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  width: number;
  height: number;
  selectedId?: string | null;
  highlightIds?: Set<string>;
  onSelect?: (id: string | null) => void;
  showEdgeLabels?: boolean;
  colors: Record<string, string>;
}

type SimNode = SimulationNodeDatum & GNode;

/** Static force-directed node-link view used for the knowledge graph (r4) and the writing map (r6). */
export function GraphView({ nodes, edges, width, height, selectedId, highlightIds, onSelect, showEdgeLabels, colors }: Props) {
  const layout = useMemo(() => {
    const sim: SimNode[] = nodes.map((n) => ({ ...n }));
    const ids = new Set(sim.map((n) => n.id));
    const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }));
    const s = forceSimulation(sim)
      .force("link", forceLink<SimNode, any>(links).id((d) => d.id).distance(nodes.length > 40 ? 40 : 90))
      .force("charge", forceManyBody().strength(nodes.length > 40 ? -60 : -260))
      .force("center", forceCenter(width / 2, height / 2))
      .force("x", forceX(width / 2).strength(0.06))
      .force("y", forceY(height / 2).strength(0.08))
      .force("collide", forceCollide(nodes.length > 40 ? 10 : 30))
      .stop();
    for (let i = 0; i < 300; i++) s.tick();
    for (const n of sim) {
      n.x = Math.max(12, Math.min(width - 12, n.x ?? 0));
      n.y = Math.max(12, Math.min(height - 12, n.y ?? 0));
    }
    const pos = new Map(sim.map((n) => [n.id, n]));
    return { sim, links: edges.filter((e) => ids.has(e.source) && ids.has(e.target)), pos };
  }, [nodes, edges, width, height]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) for (const id of [e.source, e.target]) d.set(id, (d.get(id) ?? 0) + 1);
    return d;
  }, [edges]);
  const dense = nodes.length > 40;

  if (!nodes.length) return null;
  return (
    <svg width={width} height={height} className="graph" onClick={() => onSelect?.(null)}>
      {layout.links.map((e) => {
        const a = layout.pos.get(e.source)!;
        const b = layout.pos.get(e.target)!;
        return (
          <g key={e.id} className="edge">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray={e.dashed ? "4 3" : undefined}>
              <title>{e.label}</title>
            </line>
            {showEdgeLabels && (
              <text x={((a.x ?? 0) + (b.x ?? 0)) / 2} y={((a.y ?? 0) + (b.y ?? 0)) / 2} className="edge-label">
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {layout.sim.map((n) => {
        const sel = n.id === selectedId;
        const hi = highlightIds?.has(n.id);
        const r = dense ? 4 + Math.min(6, degree.get(n.id) ?? 0) : 9;
        return (
          <g
            key={n.id}
            className={`node${sel ? " selected" : ""}${hi ? " hi" : ""}`}
            transform={`translate(${n.x},${n.y})`}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect?.(sel ? null : n.id);
            }}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            <circle r={r} fill={colors[n.group] ?? "#888"} />
            <title>{n.title ?? n.label}</title>
            {(!dense || hi || sel || (degree.get(n.id) ?? 0) >= 3) && (
              <text x={r + 3} y={4}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
