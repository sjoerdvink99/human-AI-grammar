// r14 (artifact spatial) view + human select → r16 (selection spatial).
import { useRef, useState } from 'react';
import type { Layout, Scene, SceneView, SpatialSelection } from '../../shared/types.ts';

interface Props {
  scene: Scene;
  layout: Layout;
  view: SceneView;
  selection: SpatialSelection;
  onSelect: (s: SpatialSelection) => void;
  busy: boolean;
}

export function SceneCanvas({ scene, layout, view, selection, onSelect, busy }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const { width: W, depth: D } = scene.room;
  const toRoom = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const selected = new Set(selection.objectIds);

  const onObjectDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.shiftKey || e.metaKey) {
      const ids = selected.has(id) ? selection.objectIds.filter((x) => x !== id) : [...selection.objectIds, id];
      onSelect({ objectIds: ids, region: selection.region });
    } else onSelect({ objectIds: [id] });
  };
  const onDown = (e: React.PointerEvent) => { const p = toRoom(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (drag) { const p = toRoom(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const onUp = () => {
    if (!drag) return;
    const r = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    if (r.w < 8 && r.h < 8) { onSelect({ objectIds: [] }); return; }
    const inside = layout.filter((o) => o.x >= r.x && o.x <= r.x + r.w && o.y >= r.y && o.y <= r.y + r.h).map((o) => o.id);
    onSelect({ objectIds: inside, region: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } });
  };

  const floor = layout.filter((o) => o.assetId === 'rug' || o.assetId === 'play_mat');
  const rest = layout.filter((o) => !floor.includes(o));
  return (
    <svg ref={svgRef} className={`scene ${busy ? 'busy' : ''}`} viewBox={`-30 -30 ${W + 60} ${D + 60}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e4ddd2" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={D} fill={view.showGrid ? 'url(#grid)' : '#faf7f2'} stroke="#5b5146" strokeWidth={6} />
      <text x={0} y={-10} className="dim">{W} × {D} cm · N ↑</text>
      {[...floor, ...rest].map((o) => {
        const sel = selected.has(o.id);
        const t = `rotate(${o.rot} ${o.x} ${o.y})`;
        return (
          <g key={o.id} className={`obj ${sel ? 'sel' : ''}`} onPointerDown={(e) => onObjectDown(e, o.id)}>
            {o.shape === 'circle'
              ? <ellipse cx={o.x} cy={o.y} rx={o.w / 2} ry={o.h / 2} fill={o.color} transform={t} />
              : <rect x={o.x - o.w / 2} y={o.y - o.h / 2} width={o.w} height={o.h} rx={4} fill={o.color} transform={t} />}
            {o.shape === 'rect' && <line x1={o.x - o.w / 2 + 6} x2={o.x + o.w / 2 - 6} y1={o.y + o.h / 2 - 5} y2={o.y + o.h / 2 - 5} className="front" transform={t} />}
            <text x={o.x} y={o.y} className="label">{o.name}</text>
            <title>{`${o.name} (${o.id})`}</title>
          </g>
        );
      })}
      {selection.region && !drag && <rect className="region" x={selection.region.x} y={selection.region.y} width={selection.region.w} height={selection.region.h} />}
      {drag && <rect className="region" x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} />}
    </svg>
  );
}
