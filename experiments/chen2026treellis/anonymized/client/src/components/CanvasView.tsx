// r5 (artifact visual). Clicking a shape is human select → r7; the overlay is r8 (selection visual),
// produced by tool translate from the selection record.
import { useLayoutEffect, useRef, useState } from 'react';

interface Box { left: number; top: number; width: number; height: number }

export function CanvasView({ svg, selected, target, onSelect }: {
  svg: string;
  selected: string | null;
  target: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<{ sel: Box | null; tgt: Box | null }>({ sel: null, tgt: null });

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => {
      const base = host.getBoundingClientRect();
      const boxOf = (id: string | null): Box | null => {
        if (id === null) return null;
        const el = host.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left - base.left - 3, top: r.top - base.top - 3, width: r.width + 6, height: r.height + 6 };
      };
      setBoxes({ sel: boxOf(selected), tgt: target && target !== selected ? boxOf(target) : null });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [svg, selected, target]);

  return (
    <div className="canvas-wrap">
      <div
        ref={ref}
        className="canvas"
        onClick={(e) => {
          const el = (e.target as Element).closest('[data-node-id]');
          const id = el?.getAttribute('data-node-id');
          onSelect(id ? id : null);
        }}
      >
        <div className="svg-host" dangerouslySetInnerHTML={{ __html: svg }} />
        {boxes.sel && <div className="sel-box" style={boxes.sel}><span>{selected}</span></div>}
        {boxes.tgt && <div className="sel-box target" style={boxes.tgt}><span>✦ {target}</span></div>}
      </div>
      <p className="muted small">Click a shape to select it; click the background to clear.</p>
    </div>
  );
}
