// P3/P7 [tool_1 execute]: the running simulation (iframe). The overlay implements the
// freehand [human select] of chat_region (P5), redraw_region (P7) and subgraph_region (P8).
import { forwardRef, useEffect, useRef, useState } from 'react';
import { SIM_HEIGHT, SIM_WIDTH, type Region } from '../../shared/types';
import { elementsInRegion } from '../lib/runner';

export type MarkMode = 'chat' | 'redraw' | 'inspect' | null;
const MODE_COLOR: Record<string, string> = { chat: '#2563eb', redraw: '#db2777', inspect: '#ef4444' };

interface Props {
  html: string;
  reloadKey: number;
  mode: MarkMode;
  region: Region | null;
  onRegion: (r: Region) => void;
  scale: number;
}

export const SimulationView = forwardRef<HTMLIFrameElement, Props>(function SimulationView(
  { html, reloadKey, mode, region, onRegion, scale },
  frameRef,
) {
  const [stroke, setStroke] = useState<[number, number][] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => setStroke(null), [mode]);

  const toSim = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIM_WIDTH, ((e.clientY - r.top) / r.height) * SIM_HEIGHT];
  };
  const finish = () => {
    if (!stroke || stroke.length < 3) return setStroke(null);
    const xs = stroke.map((p) => p[0]);
    const ys = stroke.map((p) => p[1]);
    const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const frame = (frameRef as React.RefObject<HTMLIFrameElement>).current;
    const points = [...stroke, stroke[0]].map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]);
    onRegion({ points, bbox, elements: frame ? elementsInRegion(frame, bbox) : [] });
    setStroke(null);
  };
  const shown = stroke ?? region?.points;

  return (
    <div className="sim-wrap" style={{ width: SIM_WIDTH * scale, height: SIM_HEIGHT * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: SIM_WIDTH, height: SIM_HEIGHT, position: 'relative' }}>
        <iframe
          key={reloadKey}
          ref={frameRef}
          title="simulation"
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: SIM_WIDTH, height: SIM_HEIGHT, border: 0, background: '#fff' }}
        />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIM_WIDTH} ${SIM_HEIGHT}`}
          className="sim-overlay"
          style={{ pointerEvents: mode ? 'auto' : 'none', cursor: mode ? 'crosshair' : 'default' }}
          onPointerDown={(e) => {
            if (!mode) return;
            (e.target as Element).setPointerCapture(e.pointerId);
            setStroke([toSim(e)]);
          }}
          onPointerMove={(e) => stroke && setStroke([...stroke, toSim(e)])}
          onPointerUp={finish}
        >
          {shown && (
            <polyline
              points={shown.map((p) => p.join(',')).join(' ')}
              fill="rgba(239,68,68,0.08)"
              stroke={MODE_COLOR[mode ?? 'inspect'] ?? '#ef4444'}
              strokeWidth={4}
              strokeDasharray={stroke ? '6 4' : undefined}
            />
          )}
        </svg>
      </div>
      {mode && <div className="sim-banner">Circle the part of the simulation {mode === 'chat' ? 'you want to discuss' : mode === 'redraw' ? 'to redraw' : 'to inspect'}</div>}
    </div>
  );
});
