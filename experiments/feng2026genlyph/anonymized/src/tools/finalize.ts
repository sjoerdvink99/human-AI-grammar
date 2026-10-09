import type { ComposedChart, FinalSpec } from "../types.ts";
import { fmt } from "./profile.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** tool_3 compose: r26 + r23* -> r27 (final annotated chart) */
export function finalizeChart(r23: ComposedChart[], r26: FinalSpec): string {
  const chart = r23[r26.chartIndex];
  if (!chart) throw new Error("choose a chart");
  const top = 18 + (r26.title ? 26 : 0) + (r26.subtitle ? 18 : 0);
  const bottom = r26.note ? 28 : 8;
  const W = Math.max(chart.width + 40, 360);
  const H = chart.height + top + bottom;
  const ox = (W - chart.width) / 2;
  const inner = chart.svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const notes = r26.annotate
    .filter((c) => chart.positions[c])
    .map((c, i) => {
      const p = chart.positions[c];
      const x = ox + p.x - 3,
        y = top + p.y - 3;
      const lx = ox + p.x + p.w + 6;
      const ly = top + p.y - 8 - (i % 2) * 10;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(p.w + 6).toFixed(1)}" height="${(p.h + 6).toFixed(1)}" rx="5" fill="none" stroke="#d9480f" stroke-width="2"/>
<line x1="${(x + p.w + 6).toFixed(1)}" y1="${y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${(ly + 3).toFixed(1)}" stroke="#d9480f"/>
<text x="${(lx + 2).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" font-weight="bold" fill="#d9480f">${esc(c)}: ${fmt(chart.values[c])}</text>`;
    });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${(W * 2).toFixed(0)}" height="${(H * 2).toFixed(0)}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#fffdf8"/>
${r26.title ? `<text x="16" y="34" font-size="20" font-weight="bold" fill="#1d1d1f">${esc(r26.title)}</text>` : ""}
${r26.subtitle ? `<text x="16" y="${r26.title ? 54 : 30}" font-size="12" fill="#555">${esc(r26.subtitle)}</text>` : ""}
<g transform="translate(${ox.toFixed(1)} ${top})">${inner}</g>
${notes.join("\n")}
${r26.note ? `<text x="16" y="${H - 10}" font-size="10" fill="#777">${esc(r26.note)}</text>` : ""}
</svg>`;
}
