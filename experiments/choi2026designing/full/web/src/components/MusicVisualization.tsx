import { useEffect, useRef, type RefObject } from "react";
import type { Session } from "../api.ts";

type Viz = NonNullable<Session["songs"][number]["musicVisualization"]>;

/**
 * Draws music_visualization on a canvas, synchronised with the audio element:
 * karaoke-style animated lyrics, pulses on every beat (larger on bar starts),
 * and a loudness ribbon of the whole song with a playhead.
 */
export function MusicVisualization({ viz, audioRef, vibrate }: { viz: Viz; audioRef: RefObject<HTMLAudioElement | null>; vibrate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vibrateRef = useRef(vibrate);
  vibrateRef.current = vibrate;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let lastBeat = -1;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const seek = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (e.clientY - rect.top > rect.height - 50 && audioRef.current) {
        audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * viz.duration;
      }
    };
    canvas.addEventListener("click", seek);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = audioRef.current?.currentTime ?? 0;
      const { palette } = viz;
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, w, h);

      // --- beats ---
      let bi = -1;
      for (let i = 0; i < viz.beats.length && viz.beats[i].time <= t; i++) bi = i;
      const beat = bi >= 0 ? viz.beats[bi] : null;
      const since = beat ? t - beat.time : 99;
      if (beat && bi !== lastBeat && since < 0.15 && !audioRef.current?.paused) {
        lastBeat = bi;
        if (vibrateRef.current && "vibrate" in navigator) navigator.vibrate(beat.downbeat ? 70 : 30);
      }
      const frame = Math.min(viz.envelope.loudness.length - 1, Math.floor(t / viz.envelope.frameHop));
      const loud = viz.envelope.loudness[Math.max(0, frame)] ?? 0;
      const decay = Math.exp(-since * 6);
      const cx = w / 2;
      const cy = h * 0.36;
      const base = Math.min(w, h) * 0.09;
      // expanding rings for recent beats
      if (!reduceMotion) {
        for (let k = Math.max(0, bi - 3); k <= bi; k++) {
          const age = t - viz.beats[k].time;
          if (age < 0 || age > 1.2) continue;
          ctx.strokeStyle = viz.beats[k].downbeat ? palette.accent : palette.primary;
          ctx.globalAlpha = Math.max(0, 1 - age / 1.2) * 0.8;
          ctx.lineWidth = viz.beats[k].downbeat ? 5 : 3;
          ctx.beginPath();
          ctx.arc(cx, cy, base + age * Math.min(w, h) * 0.35, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // central pulse
      const r = base * (0.7 + 0.5 * loud + (beat?.downbeat ? 0.55 : 0.35) * decay * (0.5 + 0.5 * (beat?.strength ?? 0.5)));
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, palette.accent);
      grad.addColorStop(1, palette.primary);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // beat counter dots (1-2-3-4)
      if (beat) {
        let pos = 0;
        for (let k = bi; k >= 0 && !viz.beats[k].downbeat; k--) pos++;
        for (let d = 0; d < 4; d++) {
          ctx.fillStyle = d === pos % 4 ? palette.accent : "rgba(255,255,255,0.18)";
          ctx.beginPath();
          ctx.arc(24 + d * 22, 24, d === pos % 4 ? 8 : 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- lyrics (karaoke) ---
      let li = -1;
      for (let i = 0; i < viz.lines.length; i++) if (viz.lines[i].start - 0.4 <= t) li = i;
      const line = li >= 0 ? viz.lines[li] : null;
      const lyricY = h * 0.68;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (line && t < line.end + 2.5) {
        ctx.font = `600 13px system-ui, sans-serif`;
        ctx.fillStyle = palette.primary;
        ctx.fillText(line.section.toUpperCase(), cx, lyricY - 44);
        const size = Math.max(18, Math.min(34, w / 22));
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        const widths = line.words.map((wd) => ctx.measureText(wd.word + " ").width);
        let x = cx - widths.reduce((a, b) => a + b, 0) / 2;
        ctx.textAlign = "left";
        line.words.forEach((wd, k) => {
          const active = t >= wd.start && t < wd.end + 0.05;
          const sung = t >= wd.start;
          const lift = active && !reduceMotion ? -6 * Math.exp(-(t - wd.start) * 4) : 0;
          ctx.fillStyle = sung ? palette.text : "rgba(255,255,255,0.38)";
          if (active) {
            ctx.fillStyle = palette.accent;
          }
          ctx.fillText(wd.word, x, lyricY + lift);
          if (sung) {
            // underline progress
            const frac = Math.min(1, (t - wd.start) / Math.max(0.05, wd.end - wd.start));
            ctx.fillStyle = palette.primary;
            ctx.fillRect(x, lyricY + size * 0.62, (widths[k] - ctx.measureText(" ").width) * frac, 3);
          }
          x += widths[k];
        });
        ctx.textAlign = "center";
      } else if (t < 0.5 || !line) {
        ctx.font = `600 18px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(audioRef.current?.paused ? "Press play — lyrics will appear here" : "♪ instrumental ♪", cx, lyricY);
      }
      const next = viz.lines[li + 1];
      if (next) {
        ctx.font = `500 16px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillText(next.text, cx, lyricY + 46);
      }

      // --- loudness ribbon + beat ticks + playhead ---
      const ry = h - 40;
      const rh = 28;
      const L = viz.envelope.loudness;
      ctx.fillStyle = palette.primary;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < w; i += 2) {
        const v = L[Math.floor((i / w) * L.length)] ?? 0;
        ctx.fillRect(i, ry + rh / 2 - (v * rh) / 2, 1.5, Math.max(1, v * rh));
      }
      ctx.globalAlpha = 1;
      for (const ln of viz.lines) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect((ln.start / viz.duration) * w, ry + rh + 2, Math.max(2, ((ln.end - ln.start) / viz.duration) * w), 3);
      }
      ctx.fillStyle = palette.text;
      ctx.fillRect((t / viz.duration) * w - 1, ry - 4, 2, rh + 10);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("click", seek);
    };
  }, [viz, audioRef]);

  return <canvas ref={canvasRef} className="viz" role="img" aria-label="Animated lyrics and beat visualization of your song" />;
}
