import { useRef } from 'react';
import type { Canvas, ConstraintIssue, Element, Project } from '../../../shared/types';
import { fileUrl } from '../api';

export const elTransform = (e: Element) =>
  `translate(${e.x} ${e.y}) rotate(${e.rotation}) scale(${e.scale}) translate(${-e.width / 2} ${-e.height / 2})`;

export function framePath(c: Canvas, frameWidthPx: number) {
  const f = frameWidthPx;
  return `M0,0H${c.width}V${c.height}H0Z M${f},${f}V${c.height - f}H${c.width - f}V${f}Z`;
}

interface Props {
  project: Project;
  canvas: Canvas;
  elements: Record<string, Element>;
  mmPerPx: number;
  activeLayerId?: string;
  selectedId?: string | null;
  dimOthers?: boolean;
  readOnly?: boolean;
  issues?: ConstraintIssue[];
  highlightIssue?: string | null;
  onSelect?: (id: string | null, layerId?: string) => void;
  onChange?: (id: string, patch: Partial<Element>) => void;
  onCommit?: () => void;
}

/** tool_2 canvas + [human modify]: drag to move, corner handle to scale, top handle to rotate. */
export default function LayerCanvas(p: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { mode: 'move' | 'scale' | 'rotate'; id: string; p0: [number, number]; e0: Element }>(null);
  const { canvas } = p;
  const toCanvas = (ev: React.PointerEvent): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [r.x, r.y];
  };
  const begin = (ev: React.PointerEvent, mode: 'move' | 'scale' | 'rotate', e: Element) => {
    if (p.readOnly) return;
    ev.stopPropagation();
    (ev.currentTarget as unknown as SVGElement).setPointerCapture?.(ev.pointerId);
    p.onSelect?.(e.id, e.layerId);
    drag.current = { mode, id: e.id, p0: toCanvas(ev), e0: { ...e } };
  };
  const move = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toCanvas(ev);
    const { e0 } = d;
    if (d.mode === 'move') p.onChange?.(d.id, { x: e0.x + x - d.p0[0], y: e0.y + y - d.p0[1] });
    else if (d.mode === 'scale') {
      const r0 = Math.hypot(d.p0[0] - e0.x, d.p0[1] - e0.y) || 1;
      const r1 = Math.hypot(x - e0.x, y - e0.y);
      p.onChange?.(d.id, { scale: Math.max(0.05, (e0.scale * r1) / r0) });
    } else {
      const a0 = Math.atan2(d.p0[1] - e0.y, d.p0[0] - e0.x);
      const a1 = Math.atan2(y - e0.y, x - e0.x);
      let rot = e0.rotation + ((a1 - a0) * 180) / Math.PI;
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
      p.onChange?.(d.id, { rotation: ((rot % 360) + 360) % 360 });
    }
  };
  const end = () => {
    if (drag.current) {
      drag.current = null;
      p.onCommit?.();
    }
  };

  const layers = [...canvas.layers].sort((a, b) => b.depth - a.depth); // draw back to front
  const sel = p.selectedId ? p.elements[p.selectedId] : null;
  const vb = Math.max(canvas.width, canvas.height);
  const hs = vb / 80; // handle size in canvas units

  return (
    <svg
      ref={svgRef}
      className="layer-canvas"
      viewBox={`${-vb * 0.04} ${-vb * 0.04} ${canvas.width + vb * 0.08} ${canvas.height + vb * 0.08}`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerDown={() => p.onSelect?.(null)}
    >
      <defs>
        <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#f4f1ea" />
          <rect width="8" height="8" fill="#e8e3d8" />
          <rect x="8" y="8" width="8" height="8" fill="#e8e3d8" />
        </pattern>
      </defs>
      <rect width={canvas.width} height={canvas.height} fill="url(#checker)" stroke="#999" strokeWidth={vb / 600} />
      {layers.map((l) => {
        if (!l.visible) return null;
        const dim = p.dimOthers && p.activeLayerId && l.id !== p.activeLayerId;
        return (
          <g key={l.id} opacity={dim ? 0.25 : 1} style={{ pointerEvents: dim ? 'none' : 'auto' }}>
            {l.frame && <path d={framePath(canvas, l.frameWidthMm / p.mmPerPx)} fill="#d8cbb5" fillRule="evenodd" />}
            {l.elementIds.map((id) => {
              const e = p.elements[id];
              if (!e) return null;
              return (
                <g key={id} transform={elTransform(e)} onPointerDown={(ev) => begin(ev, 'move', e)} style={{ cursor: p.readOnly ? 'default' : 'move' }}>
                  <image href={fileUrl(p.project, e.texture)} width={e.width} height={e.height} />
                  <path d={e.path} fill="transparent" fillRule="evenodd" />
                </g>
              );
            })}
          </g>
        );
      })}
      {p.issues?.map((i) => (
        <g key={i.id} className={'issue ' + i.type + (p.highlightIssue === i.id ? ' hl' : '')}>
          <rect x={i.box[0] - 3} y={i.box[1] - 3} width={i.box[2] - i.box[0] + 6} height={i.box[3] - i.box[1] + 6} strokeWidth={vb / 300} />
          {i.from && i.to && <line x1={i.from[0]} y1={i.from[1]} x2={i.to[0]} y2={i.to[1]} strokeWidth={vb / 400} strokeDasharray={`${vb / 100}`} />}
          <text x={i.box[0]} y={i.box[1] - 6} fontSize={vb / 45}>
            {i.id}
          </text>
        </g>
      ))}
      {sel && !p.readOnly && (
        <g>
          <g transform={elTransform(sel)}>
            <path d={sel.path} fill="none" stroke="#2563eb" strokeWidth={2 / sel.scale} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
            <rect width={sel.width} height={sel.height} fill="none" stroke="#2563eb" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          </g>
          <Handle e={sel} lx={sel.width} ly={sel.height} r={hs} onDown={(ev) => begin(ev, 'scale', sel)} cursor="nwse-resize" />
          <Handle e={sel} lx={sel.width / 2} ly={-hs * 3 / sel.scale} r={hs} onDown={(ev) => begin(ev, 'rotate', sel)} cursor="grab" round />
        </g>
      )}
    </svg>
  );
}

function Handle({ e, lx, ly, r, onDown, cursor, round }: { e: Element; lx: number; ly: number; r: number; onDown: (ev: React.PointerEvent) => void; cursor: string; round?: boolean }) {
  const a = (e.rotation * Math.PI) / 180;
  const dx = (lx - e.width / 2) * e.scale;
  const dy = (ly - e.height / 2) * e.scale;
  const x = e.x + dx * Math.cos(a) - dy * Math.sin(a);
  const y = e.y + dx * Math.sin(a) + dy * Math.cos(a);
  return round ? (
    <circle cx={x} cy={y} r={r * 0.7} className="handle" style={{ cursor }} onPointerDown={onDown} />
  ) : (
    <rect x={x - r / 2} y={y - r / 2} width={r} height={r} className="handle" style={{ cursor }} onPointerDown={onDown} />
  );
}
