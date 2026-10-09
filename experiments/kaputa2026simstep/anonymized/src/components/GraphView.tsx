// Node-link view for every `graph` representation (r2, r5, r8, r11, r40 highlight).
import { useMemo } from 'react';
import type { Graph } from '../shared/types';

const KIND_COLORS: Record<string, string> = {
  goal: '#1f2937',
  data: '#2563eb',
  transform: '#0891b2',
  scale: '#0d9488',
  axis: '#059669',
  mark: '#d97706',
  encoding: '#d97706',
  legend: '#7c3aed',
  label: '#7c3aed',
  annotation: '#7c3aed',
  interaction: '#db2777',
  layout: '#4b5563',
  style: '#9333ea',
  audience: '#64748b',
};
export const kindColor = (k: string) => KIND_COLORS[k] ?? '#64748b';

const NODE_W = 150;
const NODE_H = 38;
const COL = 200;
const ROW = 54;

export function layoutGraph(g: Graph) {
  const incoming = new Map<string, string[]>();
  g.nodes.forEach((n) => incoming.set(n.id, []));
  g.edges.forEach((e) => incoming.get(e.target)?.push(e.source));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const d = Math.max(-1, ...(incoming.get(id) ?? []).map(depth)) + 1;
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  g.nodes.forEach((n) => depth(n.id));
  const cols = new Map<number, string[]>();
  g.nodes.forEach((n) => {
    const l = layer.get(n.id)!;
    cols.set(l, [...(cols.get(l) ?? []), n.id]);
  });
  const maxRows = Math.max(1, ...[...cols.values()].map((c) => c.length));
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((ids, l) => {
    const offset = ((maxRows - ids.length) * ROW) / 2;
    ids.forEach((id, i) => pos.set(id, { x: 10 + l * COL, y: 10 + offset + i * ROW }));
  });
  const width = 20 + (Math.max(0, ...cols.keys()) * COL + NODE_W);
  const height = 20 + maxRows * ROW - (ROW - NODE_H);
  return { pos, width, height };
}

interface Props {
  graph: Graph;
  highlight?: string[];
  selected?: string | null;
  onNodeClick?: (id: string) => void;
  maxHeight?: number;
}

export function GraphView({ graph, highlight = [], selected, onNodeClick, maxHeight = 420 }: Props) {
  const { pos, width, height } = useMemo(() => layoutGraph(graph), [graph]);
  const hl = new Set(highlight);
  return (
    <div className="graph-view" style={{ maxHeight }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
          </marker>
        </defs>
        {graph.edges.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
          const back = x2 <= x1;
          const d = back
            ? `M${a.x + NODE_W / 2},${a.y + NODE_H} C${a.x + NODE_W / 2},${a.y + NODE_H + 40} ${b.x + NODE_W / 2},${b.y + NODE_H + 40} ${b.x + NODE_W / 2},${b.y + NODE_H}`
            : `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}`;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.3} markerEnd="url(#arrow)">
                {e.label && <title>{e.label}</title>}
              </path>
            </g>
          );
        })}
        {graph.nodes.map((n) => {
          const p = pos.get(n.id)!;
          const isHl = hl.has(n.id);
          const isSel = selected === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              onClick={() => onNodeClick?.(n.id)}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            >
              <title>{`${n.label} [${n.kind}]\n${n.description}`}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={7}
                fill={isHl ? '#fef08a' : '#fff'}
                stroke={isSel ? '#111827' : kindColor(n.kind)}
                strokeWidth={isSel || isHl ? 2.5 : 1.4}
              />
              <rect width={5} height={NODE_H} rx={2} fill={kindColor(n.kind)} />
              <text x={12} y={16} fontSize={12} fontWeight={600} fill="#111827">
                {n.label.length > 20 ? n.label.slice(0, 19) + '…' : n.label}
              </text>
              <text x={12} y={30} fontSize={10} fill="#64748b">
                {n.kind}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
