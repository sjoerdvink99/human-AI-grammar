// Renders r12 (chart spec from [tool translate]) as an SVG.
export function renderChart(spec) {
  const W = 520, H = 240, m = { t: 16, r: 12, b: 36, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const ys = spec.points.map((p) => p.y);
  const yMin = spec.kind === 'line' ? Math.floor(Math.min(...ys) * 0.9) : 0;
  const yMax = Math.max(...ys) * 1.05 || 1;
  const n = spec.points.length;
  const bw = iw / n;
  const x = (i) => m.l + i * bw + bw / 2;
  const y = (v) => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ticks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  let g = ticks
    .map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${m.l - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t >= 100 ? Math.round(t) : t.toFixed(1)}</text>`)
    .join('');
  const every = Math.ceil(n / 12);
  g += spec.points
    .map((p, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - m.b + 14}" class="tick" text-anchor="middle">${esc(p.x)}</text>` : ''))
    .join('');

  if (spec.kind === 'line') {
    const d = spec.points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.y)}`).join('');
    g += `<path d="${d}" class="line"/>`;
    g += spec.points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3" class="dot"><title>${esc(p.x)}:00 — ${p.y} ${esc(spec.unit)}</title></circle>`).join('');
  } else {
    g += spec.points
      .map((p, i) => {
        const hl = spec.highlight && p.x === spec.highlight ? ' hl' : '';
        const top = y(p.y);
        return `<rect x="${x(i) - bw * 0.38}" y="${top}" width="${bw * 0.76}" height="${Math.max(0, m.t + ih - top)}" rx="2" class="bar${hl}"><title>${esc(p.x)} — ${p.y} ${esc(spec.unit)}</title></rect>`;
      })
      .join('');
  }
  g += `<text x="${m.l + iw / 2}" y="${H - 4}" class="axis" text-anchor="middle">${esc(spec.xLabel)}</text>`;
  return `<figure class="chart"><figcaption>${esc(spec.title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}">${g}</svg><p class="muted">${esc(spec.summary)}</p></figure>`;
}
