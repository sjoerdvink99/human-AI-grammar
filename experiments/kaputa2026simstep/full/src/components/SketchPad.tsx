// P7 [human specify]: the teacher's rough replacement drawing (sketch_1: instruction visual).
import { useEffect, useRef, useState } from 'react';

const COLORS = ['#111827', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#a16207', '#ffffff'];

export function SketchPad({ onChange, width = 320, height = 240 }: { onChange: (dataUrl: string | null) => void; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const drawing = useRef(false);
  const used = useRef(false);

  const clear = () => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    used.current = false;
    onChange(null);
  };
  useEffect(clear, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height] as const;
  };

  return (
    <div className="sketchpad">
      <canvas
        ref={ref}
        width={width}
        height={height}
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as Element).setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.strokeStyle = color;
          ctx.lineWidth = size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineTo(x, y);
          ctx.stroke();
          used.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (used.current) onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      <div className="row">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
        <input type="range" min={1} max={20} value={size} onChange={(e) => setSize(Number(e.target.value))} title="brush size" />
        <button onClick={clear}>Clear</button>
      </div>
    </div>
  );
}
