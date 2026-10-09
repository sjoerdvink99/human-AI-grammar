import { useEffect, useRef } from 'react';

/** Loops a draw(ctx, t) function on a canvas. Used for scene thumbnails, reference videos and chart previews. */
export function LiveCanvas({ draw, duration, width = 960, height = 540, className, playing = true }: {
  draw: (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;
  duration: number;
  width?: number;
  height?: number;
  className?: string;
  playing?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = playing ? ((performance.now() - t0) / 1000) % (duration + 1) : duration;
      ctx.clearRect(0, 0, width, height);
      drawRef.current(ctx, Math.min(t, duration), width, height);
      if (playing) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [duration, width, height, playing]);
  // Static canvases redraw whenever the draw function changes (e.g. while editing a scene).
  useEffect(() => {
    if (playing) return;
    const ctx = ref.current!.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    draw(ctx, duration, width, height);
  });
  return <canvas ref={ref} width={width} height={height} className={className} />;
}
