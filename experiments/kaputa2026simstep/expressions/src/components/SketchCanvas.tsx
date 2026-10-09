// Process 7 [human specify] -> (sketch_1: instruction visual): freehand drawing inside the redraw region.
import { useEffect, useRef, useState } from "react";
import type { Rect } from "./RegionOverlay";

const COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"];

export function SketchCanvas({ region, onDone, onCancel }: { region: Rect; onDone: (png: string) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState(COLORS[0]);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, region.w, region.h);
  }, [region.w, region.h]);

  const at = (e: React.PointerEvent) => {
    const b = canvas.current!.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top] as const;
  };
  const clear = () => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, region.w, region.h);
    setEmpty(true);
  };

  return (
    <div className="sketch" style={{ left: region.x, top: region.y }} onPointerDown={(e) => e.stopPropagation()}>
      <canvas
        ref={canvas}
        width={region.w}
        height={region.h}
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext("2d")!;
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(...at(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          ctx.lineTo(...at(e));
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="sketch-tools">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${c === color ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
        <button onClick={clear}>Clear</button>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={empty} onClick={() => onDone(canvas.current!.toDataURL("image/png"))}>
          Use sketch
        </button>
      </div>
    </div>
  );
}
