// [tool_3 compose] layout_1 + placement_settings_1 + glyphs_1* + dataset_1 -> fgv_1
import type { Attribute, Dataset, GlyphSet, Layout, PlacementSettings, Theme } from '../types';
import { esc } from './svg';

export const THEMES: Record<Theme, { bg: string; fg: string; muted: string; font: string; panel: string }> = {
  light: { bg: '#ffffff', fg: '#222222', muted: '#9a9a9a', font: 'Helvetica, Arial, sans-serif', panel: '#f3f4f6' },
  dark: { bg: '#1c1e24', fg: '#eeeeee', muted: '#777b86', font: 'Helvetica, Arial, sans-serif', panel: '#272a33' },
  paper: { bg: '#f6f0e1', fg: '#4a3b2a', muted: '#a8977a', font: 'Georgia, "Times New Roman", serif', panel: '#ece3cc' },
};

export interface Fgv {
  svg: string;
  width: number;
  height: number;
  /** glyph centres, by row index */
  centers: Record<number, { x: number; y: number }>;
}

const num = (v: string | undefined) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function ticks(min: number, max: number, n = 5): number[] {
  if (max === min) return [min];
  const step = 10 ** Math.floor(Math.log10((max - min) / n));
  const err = ((max - min) / n) / step;
  const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) out.push(+v.toFixed(10));
  return out;
}
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(+v.toPrecision(4)));

export function composeFgv(
  glyphs: GlyphSet, ds: Dataset, attrs: Attribute[], layout: Layout, settings: PlacementSettings,
): Fgv {
  const th = THEMES[settings.theme];
  const g = layout.glyphSize;
  const s = layout.spacing;
  const W = layout.width;
  const M = 30;
  const labelH = layout.labelColumn ? 14 : 0;
  const cellH = g + labelH;
  const titleH = layout.title ? 40 : 0;
  const attr = (n: string | null) => attrs.find((a) => a.name === n);
  const xa = attr(layout.x);
  const ya = attr(layout.y);
  const centers: Record<number, { x: number; y: number }> = {};
  const deco: string[] = [];
  const axisM = layout.showAxes ? 40 : 0;
  let H = 0;
  const idx = ds.rows.map((_, i) => i);

  const text = (x: number, y: number, t: string, o: { size?: number; anchor?: string; weight?: string; color?: string; rotate?: boolean } = {}) =>
    `<text x="${x}" y="${y}" font-family='${th.font}' font-size="${o.size ?? 11}" fill="${o.color ?? th.fg}" text-anchor="${o.anchor ?? 'middle'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.rotate ? ` transform="rotate(-90 ${x} ${y})"` : ''}>${esc(t)}</text>`;

  function gridAt(items: number[], x0: number, y0: number, width: number): number {
    const cols = Math.max(1, Math.floor((width + s) / (g + s)));
    items.forEach((r, k) => {
      centers[r] = { x: x0 + (k % cols) * (g + s) + g / 2, y: y0 + Math.floor(k / cols) * (cellH + s) + g / 2 };
    });
    return Math.ceil(items.length / cols) * (cellH + s);
  }

  function xAxis(a: Attribute, x0: number, x1: number, y: number) {
    if (!layout.showAxes) return;
    deco.push(`<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${th.muted}"/>`);
    for (const t of ticks(a.min, a.max)) {
      const x = x0 + ((t - a.min) / (a.max - a.min || 1)) * (x1 - x0);
      deco.push(`<line x1="${x}" x2="${x}" y1="${y}" y2="${y + 4}" stroke="${th.muted}"/>`, text(x, y + 16, fmt(t), { color: th.muted }));
    }
    deco.push(text((x0 + x1) / 2, y + 32, a.name, { weight: 'bold' }));
  }

  /** dodge glyphs on one numeric axis into lanes; returns lane count */
  function dodge(items: number[], a: Attribute, x0: number, x1: number, baseY: number, up = true): number {
    const lanes: number[] = [];
    const sorted = [...items].sort((p, q) => (num(ds.rows[p][a.name]) ?? a.min) - (num(ds.rows[q][a.name]) ?? a.min));
    for (const r of sorted) {
      const v = num(ds.rows[r][a.name]) ?? a.min;
      const x = x0 + ((v - a.min) / (a.max - a.min || 1)) * (x1 - x0);
      let lane = lanes.findIndex((last) => x - last >= g + s * 0.5);
      if (lane < 0) { lane = lanes.length; lanes.push(-Infinity); }
      lanes[lane] = x;
      centers[r] = { x, y: up ? baseY - lane * (cellH + s * 0.5) - cellH / 2 - 4 : baseY + lane * (cellH + s * 0.5) + g / 2 };
    }
    return Math.max(1, lanes.length);
  }

  let type = layout.type;
  if ((type === 'axis' && xa?.kind !== 'numerical') || (type === 'scatter' && (xa?.kind !== 'numerical' || ya?.kind !== 'numerical'))
    || (type === 'grouped' && !xa) || (type === 'matrix' && (xa?.kind !== 'categorical' || ya?.kind !== 'categorical'))
    || (type === 'strip' && (xa?.kind !== 'numerical' || ya?.kind !== 'categorical'))) type = 'grid';

  const top = M + titleH;
  const x0 = M + (type === 'scatter' || type === 'strip' ? axisM + 50 : 0) + g / 2;
  const x1 = W - M - g / 2;

  if (type === 'grid' || type === 'sorted-grid') {
    let items = idx;
    if (type === 'sorted-grid' && xa) {
      items = [...idx].sort((p, q) => xa.kind === 'numerical'
        ? (num(ds.rows[q][xa.name]) ?? -Infinity) - (num(ds.rows[p][xa.name]) ?? -Infinity)
        : xa.values.indexOf(ds.rows[p][xa.name]) - xa.values.indexOf(ds.rows[q][xa.name]));
    }
    H = top + gridAt(items, M, top, W - 2 * M) + M;
  } else if (type === 'grouped') {
    const a = xa!;
    const groups = a.kind === 'categorical' ? a.values : [...new Set(ds.rows.map((r) => r[a.name]))];
    let y = top;
    for (const v of groups) {
      const items = idx.filter((r) => ds.rows[r][a.name] === v);
      if (!items.length) continue;
      deco.push(text(M, y + 14, `${v} (${items.length})`, { anchor: 'start', weight: 'bold', size: 13 }));
      y += 24;
      y += gridAt(items, M, y, W - 2 * M) + 10;
    }
    H = y + M;
  } else if (type === 'axis') {
    const a = xa!;
    const lanesGuess = Math.ceil(ds.rows.length / Math.max(1, Math.floor((x1 - x0) / (g + s)))) + 3;
    const baseY = top + lanesGuess * (cellH + s * 0.5) + 10;
    const lanes = dodge(idx, a, x0, x1, baseY);
    const shift = (lanesGuess - lanes) * (cellH + s * 0.5);
    for (const r of idx) centers[r].y -= shift;
    xAxis(a, x0, x1, baseY - shift);
    H = baseY - shift + axisM + M;
  } else if (type === 'scatter') {
    const plotH = Math.max(300, (x1 - x0) * 0.7);
    const yTop = top + g / 2;
    const yBot = yTop + plotH;
    for (const r of idx) {
      const vx = num(ds.rows[r][xa!.name]) ?? xa!.min;
      const vy = num(ds.rows[r][ya!.name]) ?? ya!.min;
      centers[r] = {
        x: x0 + ((vx - xa!.min) / (xa!.max - xa!.min || 1)) * (x1 - x0),
        y: yBot - ((vy - ya!.min) / (ya!.max - ya!.min || 1)) * (yBot - yTop),
      };
    }
    const axY = yBot + g / 2 + 6;
    xAxis(xa!, x0, x1, axY);
    if (layout.showAxes) {
      const ax = x0 - g / 2 - 10;
      deco.push(`<line x1="${ax}" x2="${ax}" y1="${yTop}" y2="${yBot}" stroke="${th.muted}"/>`);
      for (const t of ticks(ya!.min, ya!.max)) {
        const y = yBot - ((t - ya!.min) / (ya!.max - ya!.min || 1)) * (yBot - yTop);
        deco.push(`<line x1="${ax - 4}" x2="${ax}" y1="${y}" y2="${y}" stroke="${th.muted}"/>`, text(ax - 7, y + 4, fmt(t), { anchor: 'end', color: th.muted }));
      }
      deco.push(text(M + 10, (yTop + yBot) / 2, ya!.name, { weight: 'bold', rotate: true }));
    }
    H = axY + axisM + M;
  } else if (type === 'matrix') {
    const cols = xa!.values;
    const rows = ya!.values;
    const counts = cols.flatMap((c) => rows.map((rv) => idx.filter((r) => ds.rows[r][xa!.name] === c && ds.rows[r][ya!.name] === rv).length));
    const labelW = 110;
    const k = Math.max(1, Math.ceil(Math.sqrt(Math.max(...counts, 1))));
    const cellW = Math.max(60, Math.min((W - 2 * M - labelW) / cols.length, k * (g + s) + s));
    const perRow = Math.max(1, Math.floor((cellW - s) / (g + s)));
    const cellHt = Math.ceil(Math.max(...counts, 1) / perRow) * (cellH + s) + s;
    const gx = M + labelW;
    const gy = top + 24;
    cols.forEach((c, ci) => deco.push(text(gx + ci * cellW + cellW / 2, gy - 8, c, { weight: 'bold' })));
    rows.forEach((rv, ri) => {
      deco.push(text(gx - 8, gy + ri * cellHt + cellHt / 2, rv, { anchor: 'end', weight: 'bold' }));
      cols.forEach((c, ci) => {
        deco.push(`<rect x="${gx + ci * cellW + 1}" y="${gy + ri * cellHt + 1}" width="${cellW - 2}" height="${cellHt - 2}" fill="${th.panel}" rx="4"/>`);
        const items = idx.filter((r) => ds.rows[r][xa!.name] === c && ds.rows[r][ya!.name] === rv);
        gridAt(items, gx + ci * cellW + s, gy + ri * cellHt + s, cellW - 2 * s);
      });
    });
    deco.push(text(gx + (cols.length * cellW) / 2, top + 4, `${xa!.name} →`, { color: th.muted }));
    deco.push(text(M, gy - 8, `${ya!.name} ↓`, { anchor: 'start', color: th.muted }));
    H = gy + rows.length * cellHt + M;
  } else if (type === 'strip') {
    let y = top;
    for (const v of ya!.values) {
      const items = idx.filter((r) => ds.rows[r][ya!.name] === v);
      if (!items.length) continue;
      const lanes = dodge(items, xa!, x0, x1, y, false);
      const bandH = lanes * (cellH + s * 0.5) + 10;
      deco.push(`<rect x="${M}" y="${y - 4}" width="${W - 2 * M}" height="${bandH}" fill="${th.panel}" rx="4"/>`);
      deco.push(text(M + 8, y + bandH / 2, v, { anchor: 'start', weight: 'bold' }));
      y += bandH + 6;
    }
    xAxis(xa!, x0, x1, y + 4);
    H = y + axisM + M;
  }

  for (const [r, p] of Object.entries(layout.overrides)) if (centers[+r]) centers[+r] = p;

  const glyphEls = idx.map((r) => {
    const c = centers[r];
    if (!c) return '';
    const lbl = layout.labelColumn ? text(c.x, c.y + g / 2 + 11, String(ds.rows[r][layout.labelColumn] ?? ''), { size: 10, color: th.muted }) : '';
    return `<g class="glyph" data-row="${r}"><svg x="${c.x - g / 2}" y="${c.y - g / 2}" width="${g}" height="${g}" viewBox="${glyphs.viewBox.join(' ')}">${glyphs.glyphs[r]?.svgInner ?? ''}</svg>${lbl}</g>`;
  });

  const height = Math.max(H, 120);
  const title = layout.title ? text(W / 2, M + 18, layout.title, { size: 20, weight: 'bold' }) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><defs>${glyphs.defs}</defs><rect width="100%" height="100%" fill="${th.bg}"/>${title}${deco.join('')}${glyphEls.join('')}</svg>`;
  return { svg, width: W, height, centers };
}
