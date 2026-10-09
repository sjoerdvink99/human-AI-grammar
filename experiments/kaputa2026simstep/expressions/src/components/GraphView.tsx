// Node-link view for every graph representation (dagre layout, SVG rendering).
import dagre from "@dagrejs/dagre";
import { useMemo, useState } from "react";
import type { Graph } from "../../shared/types";

const KIND_COLORS: Record<string, string> = {
  concept: "#dbeafe",
  quantity: "#dcfce7",
  law: "#fef3c7",
  phenomenon: "#fce7f3",
  entity: "#e0e7ff",
  variable: "#dcfce7",
  process: "#fef3c7",
  container: "#f1f5f9",
  control: "#dbeafe",
  display: "#dcfce7",
  visual: "#fce7f3",
  logic: "#fef3c7",
};

interface Props {
  graph: Graph;
  selected?: string[];
  highlighted?: string[];
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (index: number) => void;
  height?: number;
  direction?: "LR" | "TB";
}

const W = 150;
const H = 44;

export function GraphView({ graph, selected = [], highlighted = [], onNodeClick, onEdgeClick, height = 360, direction = "LR" }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: direction, nodesep: 18, ranksep: 60, marginx: 10, marginy: 10 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) g.setNode(n.id, { width: W, height: H });
    graph.edges.forEach((e, i) => g.setEdge(e.source, e.target, { label: e.label, width: 60, height: 14 }, String(i)));
    dagre.layout(g);
    const gw = g.graph().width ?? 400;
    const gh = g.graph().height ?? 300;
    return {
      nodes: graph.nodes.map((n) => ({ n, ...(g.node(n.id) as { x: number; y: number }) })),
      edges: graph.edges.map((e, i) => ({ e, i, pts: (g.edge({ v: e.source, w: e.target, name: String(i) }) as { points: { x: number; y: number }[] })?.points ?? [] })),
      w: gw,
      h: gh,
    };
  }, [graph, direction]);

  const hovered = graph.nodes.find((n) => n.id === hover);
  const hl = new Set(highlighted);
  const sel = new Set(selected);
  const anyHl = hl.size > 0;

  return (
    <div className="graph-view" style={{ height }}>
      <div className="graph-scroll">
      <svg viewBox={`0 0 ${layout.w} ${layout.h}`} style={{ width: `max(100%, ${Math.round(layout.w * 0.55)}px)`, height: "auto", maxHeight: layout.h, display: "block" }} preserveAspectRatio="xMidYMin meet">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
          </marker>
        </defs>
        {layout.edges.map(({ e, i, pts }) => {
          if (!pts.length) return null;
          const d = pts.map((p, k) => `${k ? "L" : "M"}${p.x},${p.y}`).join(" ");
          const mid = pts[Math.floor(pts.length / 2)];
          const dim = anyHl && !(hl.has(e.source) && hl.has(e.target));
          return (
            <g key={i} opacity={dim ? 0.25 : 1} onClick={onEdgeClick ? () => onEdgeClick(i) : undefined} style={{ cursor: onEdgeClick ? "pointer" : undefined }}>
              <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#arrow)" />
              <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
              {e.label && (
                <text x={mid.x} y={mid.y - 4} fontSize={10} textAnchor="middle" fill="#475569">
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {layout.nodes.map(({ n, x, y }) => {
          const dim = anyHl && !hl.has(n.id);
          return (
            <g
              key={n.id}
              transform={`translate(${x - W / 2},${y - H / 2})`}
              opacity={dim ? 0.3 : 1}
              onClick={onNodeClick ? () => onNodeClick(n.id) : undefined}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: onNodeClick ? "pointer" : "default" }}
            >
              <rect
                width={W}
                height={H}
                rx={8}
                fill={KIND_COLORS[n.kind] ?? "#f8fafc"}
                stroke={sel.has(n.id) ? "#2563eb" : hl.has(n.id) ? "#f59e0b" : n.change_note ? "#16a34a" : "#94a3b8"}
                strokeWidth={sel.has(n.id) || hl.has(n.id) ? 3 : 1.2}
              />
              <text x={W / 2} y={n.kind ? 18 : 26} fontSize={12} textAnchor="middle" fontWeight={600} fill="#0f172a">
                {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
              </text>
              {n.kind && (
                <text x={W / 2} y={34} fontSize={9.5} textAnchor="middle" fill="#64748b">
                  {n.kind}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>
      {hovered && (
        <div className="graph-tip">
          <b>{hovered.label}</b> <code>{hovered.id}</code>
          <div>{hovered.description}</div>
          {hovered.change_note && <div className="note">changed: {hovered.change_note}</div>}
        </div>
      )}
    </div>
  );
}
