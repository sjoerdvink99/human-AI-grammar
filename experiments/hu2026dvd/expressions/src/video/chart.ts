/** tool_4 translate: chart_data_1 + chart_type_1 -> animated_chart_1 (a deterministic animated renderer). */
import type { ChartData, ChartType } from '../../shared/types';
import { ease } from './scene';

export interface AnimatedChart {
  data: ChartData;
  type: ChartType;
  durationSec: number;
}

export const SERIES_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#f87171', '#facc15', '#2dd4bf'];

export interface Box { x: number; y: number; w: number; h: number }

export function validateChartData(d: ChartData): string | null {
  if (d.columns.length < 2) return 'Need a category column and at least one numeric column.';
  if (!d.rows.length) return 'Need at least one row.';
  for (const [ri, r] of d.rows.entries())
    for (let c = 1; c < d.columns.length; c++)
      if (typeof r[c] !== 'number' || !Number.isFinite(r[c] as number)) return `Row ${ri + 1}, column "${d.columns[c]}" is not a number.`;
  return null;
}

export function translateChart(data: ChartData, type: ChartType): AnimatedChart {
  const err = validateChartData(data);
  if (err) throw new Error(err);
  const durationSec = type === 'race' ? Math.max(3, data.rows.length * 1.2) : 3.5;
  return { data, type, durationSec };
}

export function parseCsv(text: string): ChartData {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const split = (l: string) => l.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
  const columns = split(lines[0]);
  const rows = lines.slice(1).map((l) => split(l).map((c, i) => (i === 0 || c === '' || isNaN(Number(c)) ? c : Number(c))));
  return { columns, rows };
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10));

export function drawChart(ctx: CanvasRenderingContext2D, chart: AnimatedChart, t: number, box: Box, opts: { panel?: boolean } = {}) {
  const { data, type } = chart;
  const { x, y, w, h } = box;
  const u = Math.min(w, h) / 300;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (opts.panel !== false) {
    ctx.fillStyle = 'rgba(15,23,42,0.88)';
    ctx.fillRect(x, y, w, h);
  }
  const pad = 18 * u;
  const series = data.columns.slice(1);
  const cats = data.rows.map((r) => String(r[0]));
  const val = (r: number, s: number) => Number(data.rows[r][s + 1]) || 0;
  ctx.font = `600 ${11 * u}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  // legend
  if (type !== 'pie' && type !== 'race' && series.length > 1) {
    series.forEach((s, i) => {
      ctx.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length];
      ctx.fillRect(x + pad + i * 80 * u, y + pad * 0.6, 8 * u, 8 * u);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(s, x + pad + i * 80 * u + 12 * u, y + pad * 0.6 + 4 * u);
    });
  }
  const top = y + pad * 1.6;
  const bottom = y + h - pad * 1.4;
  const left = x + pad * 2.4;
  const right = x + w - pad;

  if (type === 'bar') {
    const max = Math.max(...data.rows.flatMap((_, r) => series.map((_, s) => val(r, s))), 1e-9);
    const gw = (right - left) / cats.length;
    const bw = (gw * 0.7) / series.length;
    cats.forEach((c, r) => {
      const k = ease((t - r * 0.25) / 1.2);
      series.forEach((_, s) => {
        const bh = ((bottom - top) * val(r, s)) / max * k;
        const bx = left + r * gw + gw * 0.15 + s * bw;
        ctx.fillStyle = SERIES_COLORS[s % SERIES_COLORS.length];
        ctx.fillRect(bx, bottom - bh, bw - 2 * u, bh);
        if (series.length === 1 && k > 0.05) {
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.fillText(fmt(val(r, s) * k), bx + bw / 2, bottom - bh - 8 * u);
        }
      });
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.fillText(c, left + r * gw + gw / 2, bottom + 10 * u);
    });
  } else if (type === 'line') {
    const vals = data.rows.flatMap((_, r) => series.map((_, s) => val(r, s)));
    const max = Math.max(...vals, 1e-9);
    const min = Math.min(0, ...vals);
    const px = (r: number) => left + ((right - left) * r) / Math.max(1, cats.length - 1);
    const py = (v: number) => bottom - ((bottom - top) * (v - min)) / (max - min);
    const k = ease(t / 2.5) * (cats.length - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();
    cats.forEach((c, r) => {
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.fillText(c, px(r), bottom + 10 * u);
    });
    series.forEach((_, s) => {
      ctx.strokeStyle = SERIES_COLORS[s % SERIES_COLORS.length];
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      for (let r = 0; r <= Math.floor(k); r++) (r ? ctx.lineTo : ctx.moveTo).call(ctx, px(r), py(val(r, s)));
      const f = k - Math.floor(k);
      const r0 = Math.floor(k);
      let ex = px(r0), ey = py(val(r0, s));
      if (r0 < cats.length - 1 && f > 0) {
        ex = px(r0) + (px(r0 + 1) - px(r0)) * f;
        ey = py(val(r0, s) + (val(r0 + 1, s) - val(r0, s)) * f);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(ex, ey, 4 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      const cur = r0 < cats.length - 1 ? val(r0, s) + (val(r0 + 1, s) - val(r0, s)) * f : val(r0, s);
      ctx.fillText(fmt(cur), ex + 6 * u, ey - 10 * u);
    });
  } else if (type === 'pie') {
    const total = data.rows.reduce((a, _, r) => a + Math.max(0, val(r, 0)), 0) || 1;
    const cx = x + w * 0.38;
    const cy = y + h / 2;
    const rad = Math.min(w * 0.3, h * 0.4);
    const sweep = ease(t / 2) * Math.PI * 2;
    let a0 = -Math.PI / 2;
    data.rows.forEach((row, r) => {
      const a = (Math.max(0, val(r, 0)) / total) * Math.PI * 2;
      const end = Math.min(a0 + a, -Math.PI / 2 + sweep);
      if (end > a0) {
        ctx.fillStyle = SERIES_COLORS[r % SERIES_COLORS.length];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rad, a0, end);
        ctx.fill();
      }
      ctx.fillStyle = SERIES_COLORS[r % SERIES_COLORS.length];
      const ly = y + pad + r * 18 * u;
      ctx.fillRect(x + w * 0.74, ly, 9 * u, 9 * u);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(`${row[0]} ${Math.round((val(r, 0) / total) * 100)}%`, x + w * 0.74 + 13 * u, ly + 5 * u);
      a0 += a;
    });
  } else {
    // race: rows are time steps, numeric columns are competitors
    const steps = data.rows.length;
    const pos = Math.min(steps - 1, Math.max(0, (t / chart.durationSec) * steps - 0.3));
    const i0 = Math.floor(pos);
    const f = ease(pos - i0);
    const cur = series.map((name, s) => ({
      name,
      s,
      v: i0 < steps - 1 ? val(i0, s) + (val(i0 + 1, s) - val(i0, s)) * f : val(i0, s),
    }));
    const sorted = [...cur].sort((a, b) => b.v - a.v);
    const max = Math.max(...cur.map((c) => c.v), 1e-9);
    const bh = (bottom - top) / Math.max(series.length, 1);
    const l2 = x + pad * 4;
    sorted.forEach((c, rank) => {
      const by = top + rank * bh;
      ctx.fillStyle = SERIES_COLORS[c.s % SERIES_COLORS.length];
      const len = ((right - l2 - 40 * u) * c.v) / max;
      ctx.fillRect(l2, by + bh * 0.15, len, bh * 0.7);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'right';
      ctx.fillText(c.name, l2 - 6 * u, by + bh / 2);
      ctx.textAlign = 'left';
      ctx.fillText(fmt(c.v), l2 + len + 4 * u, by + bh / 2);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `800 ${28 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(String(data.rows[Math.round(pos)][0]), right, bottom - 10 * u);
  }
  ctx.restore();
}
