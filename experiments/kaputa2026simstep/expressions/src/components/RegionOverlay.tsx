// [human select] -> (…_region: selection spatial): drag a rectangle directly on the simulation.
import { useRef, useState } from "react";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  rect: Rect | null;
  onRect: (r: Rect) => void;
  color?: string;
  label?: string;
}

export function RegionOverlay({ rect, onRect, color = "#2563eb", label }: Props) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const pos = (e: React.PointerEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const shown = draft ?? rect;
  return (
    <div
      className="region-overlay"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = pos(e);
        setDraft({ ...start.current, w: 0, h: 0 });
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const p = pos(e);
        const s = start.current;
        setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
      }}
      onPointerUp={() => {
        if (draft && draft.w > 8 && draft.h > 8) onRect(draft);
        start.current = null;
        setDraft(null);
      }}
    >
      {shown && (
        <div className="region-rect" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h, borderColor: color, background: `${color}22` }}>
          {label && <span style={{ background: color }}>{label}</span>}
        </div>
      )}
      {!shown && <div className="region-hint">Drag a rectangle on the simulation</div>}
    </div>
  );
}
