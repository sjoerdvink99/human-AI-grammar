// r18 / r20 / r38: live rendering of the program (tool_1 execute) in a sandboxed iframe,
// with an overlay for spatial selection (r26, r34, r39) and sketching (r35).
import { useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS, type Region, type Stroke } from '../shared/types';
import { buildSrcdoc } from '../tools/sandbox';

export type OverlayMode = 'none' | 'region' | 'sketch';

interface Props {
  code: string;
  data?: unknown; // undefined → SAMPLE_DATA
  mode?: OverlayMode;
  region?: Region | null;
  onRegion?: (r: Region | null) => void;
  strokes?: Stroke[];
  onStrokes?: (s: Stroke[]) => void;
  scale?: number;
}

let n = 0;

export function VisualView({ code, data, mode = 'none', region, onRegion, strokes = [], onStrokes, scale = 1 }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runId = useMemo(() => `view${++n}`, [code, data]);
  const srcdoc = useMemo(() => buildSrcdoc(code, data, runId, true), [code, data, runId]);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<Stroke | null>(null);

  useEffect(() => {
    setErrors([]);
    const onMsg = (ev: MessageEvent) => {
      if (ev.source === iframeRef.current?.contentWindow && ev.data?.__sandbox === runId) setErrors(ev.data.errors ?? []);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [runId]);

  const pt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(CANVAS.width, ((e.clientX - r.left) / r.width) * CANVAS.width)),
      y: Math.max(0, Math.min(CANVAS.height, ((e.clientY - r.top) / r.height) * CANVAS.height)),
    };
  };
  const inRegion = (p: { x: number; y: number }) =>
    !!region && p.x >= region.x && p.x <= region.x + region.width && p.y >= region.y && p.y <= region.y + region.height;

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'none') return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = pt(e);
    if (mode === 'region') setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y });
    if (mode === 'sketch' && inRegion(p)) setCurrent([[p.x, p.y]]);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pt(e);
    if (drag) setDrag({ ...drag, x: p.x, y: p.y });
    if (current && inRegion(p)) setCurrent([...current, [p.x, p.y]]);
  };
  const onUp = () => {
    if (drag) {
      const r = { x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y), width: Math.abs(drag.x - drag.x0), height: Math.abs(drag.y - drag.y0) };
      onRegion?.(r.width > 4 && r.height > 4 ? r : null);
      setDrag(null);
    }
    if (current) {
      if (current.length > 1) onStrokes?.([...strokes, current]);
      setCurrent(null);
    }
  };

  const shown = drag
    ? { x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y), width: Math.abs(drag.x - drag.x0), height: Math.abs(drag.y - drag.y0) }
    : region;

  return (
    <div className="visual-view">
      <div className="canvas-wrap" style={{ width: CANVAS.width * scale, height: CANVAS.height * scale }}>
        <iframe
          ref={iframeRef}
          title="rendering"
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          style={{ width: CANVAS.width, height: CANVAS.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        />
        <svg
          className={`overlay mode-${mode}`}
          viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
          style={{ pointerEvents: mode === 'none' ? 'none' : 'all' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {shown && (
            <rect x={shown.x} y={shown.y} width={shown.width} height={shown.height} className="region-rect" />
          )}
          {[...strokes, ...(current ? [current] : [])].map((s, i) => (
            <polyline key={i} points={s.map((p) => p.join(',')).join(' ')} className="stroke" />
          ))}
        </svg>
      </div>
      {errors.length > 0 && (
        <div className="error small">
          Runtime errors: {errors.slice(0, 3).join(' · ')}
        </div>
      )}
    </div>
  );
}
