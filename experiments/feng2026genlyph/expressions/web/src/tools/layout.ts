import type { Attributes, Dataset, Glyph, Layout, LayoutOption, PlacementSettings } from '../types';

const NAMES: Record<string, string> = {
  grid: 'Grid', sortedGrid: 'Sorted grid', scatter: 'Scatter plot', groupedGrid: 'Grouped grid', circular: 'Circular',
};
export const layoutName = (t: string) => NAMES[t] || t;

/** [tool_4 match] placement_settings_1 + dataset_1 -> layout_recommendation_1 (rule-based) */
export function recommendLayouts(p: PlacementSettings, attrs: Attributes, ds: Dataset): LayoutOption[] {
  const kind = (n: string) => attrs.find((a) => a.name === n)?.kind;
  const opts: LayoutOption[] = [];
  if (kind(p.xAttr) === 'numeric' && kind(p.yAttr) === 'numeric')
    opts.push({ type: 'scatter', score: 0.92, reason: `x = ${p.xAttr} and y = ${p.yAttr} are both numeric: position encodes their relation.` });
  else if (p.xAttr || p.yAttr)
    opts.push({ type: 'scatter', score: 0.3, reason: 'Scatter needs two numeric attributes for x and y.' });
  if (kind(p.groupAttr) === 'categorical') {
    const n = attrs.find((a) => a.name === p.groupAttr)!.categories!.length;
    opts.push({ type: 'groupedGrid', score: n <= 8 ? 0.85 : 0.55, reason: `Groups glyphs by ${p.groupAttr} (${n} groups) for comparison within categories.` });
  }
  if (p.sortAttr)
    opts.push({ type: 'sortedGrid', score: 0.75, reason: `Orders glyphs by ${p.sortAttr} so rank is read left-to-right.` });
  opts.push({
    type: 'circular', score: ds.rows.length <= 40 ? 0.5 : 0.2,
    reason: ds.rows.length <= 40 ? 'A ring works for small datasets and gives every glyph equal prominence.' : 'Too many rows for a readable ring.',
  });
  opts.push({ type: 'grid', score: 0.45, reason: 'Compact overview in data order; good default for browsing every glyph.' });
  return opts.sort((a, b) => b.score - a.score);
}

const esc = (s: unknown) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** [tool_3 compose] layout_1 + placement_settings_1 + glyphs_1* + dataset_1 -> fgv_1 */
export function composeFGV(glyphs: Glyph[], ds: Dataset, attrs: Attributes, p: PlacementSettings, layout: Layout): string {
  const s = p.glyphSize, pad = layout.padding, labelH = layout.showLabels && p.labelAttr ? 14 : 0;
  const cell = s + pad;
  const parts: string[] = [];
  const place = (g: Glyph, x: number, y: number) => {
    parts.push(`<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="${g.viewBox}" overflow="visible">${g.svgInner}</svg>`);
    if (labelH) parts.push(`<text x="${x + s / 2}" y="${y + s + 11}" font-size="10" text-anchor="middle" fill="#333">${esc(ds.rows[g.rowIndex][p.labelAttr])}</text>`);
  };
  let W = p.width, H = 0;
  const gridOf = (list: Glyph[], x0: number, y0: number) => {
    const cols = Math.max(1, Math.floor((W - pad) / cell));
    list.forEach((g, i) => place(g, x0 + pad + (i % cols) * cell, y0 + pad + Math.floor(i / cols) * (cell + labelH)));
    return Math.ceil(list.length / cols) * (cell + labelH) + pad;
  };
  const sorted = (list: Glyph[]) =>
    p.sortAttr
      ? [...list].sort((a, b) => {
          const va = ds.rows[a.rowIndex][p.sortAttr], vb = ds.rows[b.rowIndex][p.sortAttr];
          return typeof va === 'number' && typeof vb === 'number' ? vb - va : String(va).localeCompare(String(vb));
        })
      : list;

  if (layout.type === 'grid') H = gridOf(glyphs, 0, 0);
  else if (layout.type === 'sortedGrid') H = gridOf(sorted(glyphs), 0, 0);
  else if (layout.type === 'groupedGrid') {
    const cats = attrs.find((a) => a.name === p.groupAttr)?.categories || [];
    let y = 0;
    for (const c of cats) {
      const list = sorted(glyphs.filter((g) => String(ds.rows[g.rowIndex][p.groupAttr]) === c));
      if (!list.length) continue;
      parts.push(`<text x="${pad}" y="${y + 18}" font-size="13" font-weight="600" fill="#222">${esc(p.groupAttr)}: ${esc(c)} (${list.length})</text>`);
      y += 22;
      y += gridOf(list, 0, y);
    }
    H = y;
  } else if (layout.type === 'circular') {
    const list = sorted(glyphs);
    const r = Math.max((list.length * cell) / (2 * Math.PI), s);
    W = Math.max(W, 2 * r + cell + 2 * pad);
    H = 2 * r + cell + labelH + 2 * pad;
    const cx = W / 2, cy = H / 2;
    list.forEach((g, i) => {
      const a = (i / list.length) * 2 * Math.PI - Math.PI / 2;
      place(g, cx + r * Math.cos(a) - s / 2, cy + r * Math.sin(a) - s / 2);
    });
  } else if (layout.type === 'scatter') {
    const ax = attrs.find((a) => a.name === p.xAttr), ay = attrs.find((a) => a.name === p.yAttr);
    const m = 50;
    H = Math.round(W * 0.7);
    const sx = (v: number) => m + ((v - (ax?.min ?? 0)) / (((ax?.max ?? 1) - (ax?.min ?? 0)) || 1)) * (W - 2 * m);
    const sy = (v: number) => H - m - ((v - (ay?.min ?? 0)) / (((ay?.max ?? 1) - (ay?.min ?? 0)) || 1)) * (H - 2 * m);
    if (layout.showAxes) {
      parts.push(`<line x1="${m}" y1="${H - m}" x2="${W - m}" y2="${H - m}" stroke="#999"/><line x1="${m}" y1="${m}" x2="${m}" y2="${H - m}" stroke="#999"/>`);
      parts.push(`<text x="${W / 2}" y="${H - 15}" font-size="12" text-anchor="middle" fill="#444">${esc(p.xAttr)} (${ax?.min} – ${ax?.max})</text>`);
      parts.push(`<text x="15" y="${H / 2}" font-size="12" text-anchor="middle" fill="#444" transform="rotate(-90 15 ${H / 2})">${esc(p.yAttr)} (${ay?.min} – ${ay?.max})</text>`);
    }
    glyphs.forEach((g) => {
      const row = ds.rows[g.rowIndex];
      place(g, sx(Number(row[p.xAttr])) - s / 2, sy(Number(row[p.yAttr])) - s / 2);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;
}
