// Pointer-drawing surface used for every `[human specify]` that produces strokes.
import { useRef, useState, type ReactNode } from "react";
import { CANVAS_H, CANVAS_W, type Point, type Shape, type Stroke } from "../shared/types";
import { svgUrl } from "../lib/api";

interface Props {
  background?: string | null; // SVG markup drawn beneath
  grid?: number;
  strokes: Stroke[];
  shapes: Shape[];
  showRaw: boolean;
  pen: { color: string; width: number };
  closedFill?: boolean;
  disabled?: boolean;
  onStroke: (points: Point[]) => void;
  shapeLabel?: (s: Shape, i: number) => string | null;
  children?: ReactNode; // extra overlay content (in canvas coordinates)
}

export function toCanvasPoint(svg: SVGSVGElement, e: { clientX: number; clientY: number }): Point {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: Math.max(0, Math.min(CANVAS_W, p.x)), y: Math.max(0, Math.min(CANVAS_H, p.y)) };
}

const ptsAttr = (p: Point[]) => p.map((q) => `${q.x},${q.y}`).join(" ");

export function DrawCanvas({ background, grid, strokes, shapes, showRaw, pen, closedFill, disabled, onStroke, shapeLabel, children }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<Point[] | null>(null);

  const down = (e: React.PointerEvent) => {
    if (disabled || !ref.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setLive([toCanvasPoint(ref.current, e)]);
  };
  const move = (e: React.PointerEvent) => {
    if (!live || !ref.current) return;
    setLive([...live, toCanvasPoint(ref.current, e)]);
  };
  const up = () => {
    if (live && live.length > 2) onStroke(live);
    setLive(null);
  };

  return (
    <svg
      ref={ref}
      className={`canvas ${disabled ? "disabled" : ""}`}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <rect width={CANVAS_W} height={CANVAS_H} fill="#fff" />
      {background && <image href={svgUrl(background)} width={CANVAS_W} height={CANVAS_H} preserveAspectRatio="none" />}
      {grid && (
        <g stroke="#e6e8eb" strokeWidth={1}>
          {Array.from({ length: CANVAS_W / grid + 1 }, (_, i) => <line key={`v${i}`} x1={i * grid} y1={0} x2={i * grid} y2={CANVAS_H} strokeWidth={i % 5 === 0 ? 1.6 : 0.8} />)}
          {Array.from({ length: CANVAS_H / grid + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * grid} x2={CANVAS_W} y2={i * grid} strokeWidth={i % 5 === 0 ? 1.6 : 0.8} />)}
        </g>
      )}
      {showRaw && strokes.map((s) => (
        <polyline key={`raw${s.id}`} points={ptsAttr(s.points)} fill="none" stroke={s.color} strokeOpacity={0.35} strokeWidth={s.width} strokeDasharray="4 4" strokeLinecap="round" />
      ))}
      {shapes.map((s, i) => {
        const label = shapeLabel?.(s, i);
        return (
          <g key={s.id}>
            {s.closed ? (
              <polygon points={ptsAttr(s.points)} fill={closedFill ? s.color : "none"} fillOpacity={closedFill ? 0.28 : 0} stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" />
            ) : (
              <polyline points={ptsAttr(s.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {label && (
              <g transform={`translate(${s.bbox.x + s.bbox.w / 2},${s.bbox.y + s.bbox.h / 2})`}>
                <circle r={11} fill="#111" opacity={0.8} />
                <text textAnchor="middle" dy={4} fontSize={12} fill="#fff" fontWeight={700}>{label}</text>
              </g>
            )}
          </g>
        );
      })}
      {live && <polyline points={ptsAttr(live)} fill="none" stroke={pen.color} strokeWidth={pen.width} strokeLinecap="round" strokeLinejoin="round" />}
      {children}
    </svg>
  );
}
