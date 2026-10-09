import type { BaseChart, DataProfile, Dataset } from "../types.ts";
import { aggregate, fmt } from "./profile.ts";
import { CANVAS } from "./sanitize.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** tool_1 translate: r1/r2 -> r6, a plain bar chart showing the data's shape */
export function baseChartSvg(r1: Dataset, r2: DataProfile): BaseChart {
  const categoryField = r2.defaultCategory ?? r1.columns[0];
  const valueField = r2.defaultValue ?? "";
  const bars = aggregate(r1, categoryField, valueField, valueField ? "sum" : "count")
    .slice(0, 12)
    .map(({ category, value }) => ({ category, value }));
  const { width: W, height: H } = CANVAS;
  const pad = { l: 40, r: 10, t: 20, b: 40 };
  const max = Math.max(...bars.map((b) => b.value), 1);
  const bw = (W - pad.l - pad.r) / Math.max(bars.length, 1);
  const parts = bars.map((b, i) => {
    const h = ((H - pad.t - pad.b) * b.value) / max;
    const x = pad.l + i * bw + bw * 0.15;
    const y = H - pad.b - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="#7a8ca8"/>
<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - pad.b + 14}" font-size="10" text-anchor="middle" fill="#333">${esc(b.category.slice(0, 10))}</text>
<text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="9" text-anchor="middle" fill="#555">${fmt(b.value)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">
<rect width="${W}" height="${H}" fill="#fff"/>
<line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#999"/>
${parts.join("\n")}
<text x="${pad.l}" y="12" font-size="10" fill="#555">${esc(valueField || "count")} by ${esc(categoryField)}</text>
</svg>`;
  return { svg, categoryField, valueField, bars };
}
