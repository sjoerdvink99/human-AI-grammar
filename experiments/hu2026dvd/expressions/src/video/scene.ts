/** Deterministic scene renderer used by tool_2 execute (and for live reference-video previews). */
import type { Scene } from '../../shared/types';

export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

/** Splits "1,050 GW" into prefix / number / suffix so it can count up. */
function parseValue(v: string): { pre: string; num: number; suf: string; decimals: number } | null {
  const m = v.match(/^([^0-9-]*)(-?[0-9][0-9,]*\.?[0-9]*)(.*)$/);
  if (!m) return null;
  const raw = m[2].replace(/,/g, '');
  return { pre: m[1], num: Number(raw), suf: m[3], decimals: raw.includes('.') ? raw.split('.')[1].length : 0 };
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number, W: number, H: number, opts: { subtitles?: boolean } = {}) {
  const u = W / 960; // unit scale
  const a = ease(t / 0.8);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, scene.background);
  grad.addColorStop(1, shade(scene.background, -18));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // Scene title, top-left
  ctx.globalAlpha = a;
  ctx.fillStyle = scene.accent;
  ctx.fillRect(40 * u, 40 * u, 6 * u, 28 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `600 ${22 * u}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(scene.title, 58 * u, 63 * u);
  ctx.globalAlpha = 1;

  const v = scene.visual;
  const cx = W / 2;
  if (v.kind === 'headline' || v.kind === 'quote') {
    const size = (v.kind === 'quote' ? 40 : 54) * u;
    ctx.font = `${v.kind === 'quote' ? 'italic 500' : '800'} ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, v.label, W * 0.78);
    const y0 = H * 0.45 - ((lines.length - 1) * size * 1.2) / 2;
    lines.forEach((l, i) => {
      const la = ease((t - 0.15 * i) / 0.7);
      ctx.globalAlpha = la;
      ctx.fillStyle = i === 0 && v.kind === 'headline' ? scene.accent : '#ffffff';
      ctx.fillText(l, cx, y0 + i * size * 1.2 + (1 - la) * 20 * u);
    });
    if (v.kind === 'quote') {
      ctx.globalAlpha = a;
      ctx.fillStyle = scene.accent;
      ctx.font = `800 ${120 * u}px Georgia, serif`;
      ctx.fillText('“', cx, y0 - 30 * u);
    }
    ctx.globalAlpha = 1;
  } else if (v.kind === 'big_number') {
    const p = parseValue(v.value);
    const k = ease(t / 1.6);
    const text = p ? `${p.pre}${(p.num * k).toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })}${p.suf}` : v.value;
    ctx.textAlign = 'center';
    ctx.fillStyle = scene.accent;
    ctx.font = `900 ${150 * u}px system-ui, sans-serif`;
    ctx.globalAlpha = a;
    ctx.fillText(text, cx, H * 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${28 * u}px system-ui, sans-serif`;
    wrapText(ctx, v.label, W * 0.7).forEach((l, i) => ctx.fillText(l, cx, H * 0.5 + (50 + i * 34) * u));
    ctx.globalAlpha = 1;
  } else {
    // bar & comparison: horizontal bars
    const items = v.items.length ? v.items : [{ label: v.value || '—', value: 1 }];
    const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
    const left = W * 0.24;
    const right = W * 0.86;
    const top = H * 0.22;
    const avail = H * 0.5;
    const bh = Math.min(avail / items.length, 70 * u);
    ctx.font = `600 ${20 * u}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.globalAlpha = a;
    ctx.fillText(v.label, cx, top - 18 * u);
    items.forEach((it, i) => {
      const k = ease((t - 0.3 - i * 0.25) / 1.0);
      const y = top + i * bh + bh * 0.15;
      const len = ((right - left) * Math.abs(it.value)) / max;
      ctx.globalAlpha = Math.min(1, a);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = `500 ${20 * u}px system-ui, sans-serif`;
      ctx.fillText(it.label, left - 14 * u, y + bh * 0.45);
      ctx.fillStyle = v.kind === 'comparison' && i === 0 ? 'rgba(255,255,255,0.35)' : scene.accent;
      ctx.fillRect(left, y, len * k, bh * 0.65);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = k;
      ctx.fillText(it.value.toLocaleString('en-US'), left + len * k + 10 * u, y + bh * 0.45);
    });
    ctx.globalAlpha = 1;
  }

  // On-screen caption
  if (scene.onScreenText) {
    const ca = ease((t - 0.5) / 0.6);
    ctx.globalAlpha = ca;
    ctx.font = `700 ${26 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(scene.onScreenText, cx, H * 0.83);
    ctx.globalAlpha = 1;
  }
  // Narration as subtitles (no audio track is produced)
  if (opts.subtitles !== false && scene.narration) {
    ctx.font = `400 ${16 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, scene.narration, W * 0.8).slice(0, 2);
    lines.forEach((l, i) => {
      const y = H - (28 + (lines.length - 1 - i) * 20) * u;
      const w = ctx.measureText(l).width;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(cx - w / 2 - 8 * u, y - 16 * u, w + 16 * u, 21 * u);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(l, cx, y);
    });
  }
}

/** Draw the frame at global time t for a list of timed scenes (with a short cross-fade). */
export function drawTimeline(ctx: CanvasRenderingContext2D, scenes: { scene: Scene; start: number; end: number }[], t: number, W: number, H: number) {
  const idx = Math.max(0, scenes.findIndex((s) => t >= s.start && t < s.end));
  const cur = scenes[idx === -1 ? scenes.length - 1 : idx];
  drawScene(ctx, cur.scene, t - cur.start, W, H);
  const fade = 0.35;
  const next = scenes[idx + 1];
  if (next && cur.end - t < fade) {
    ctx.globalAlpha = 1 - (cur.end - t) / fade;
    drawScene(ctx, next.scene, 0, W, H);
    ctx.globalAlpha = 1;
  }
}
