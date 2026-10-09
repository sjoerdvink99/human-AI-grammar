import { escapeXml } from "./sanitize";
import { numericColumns } from "./table";
import type { Chart, ChartType, Table } from "./types";

const W = 720;
const H = 480;
const M = { top: 40, right: 30, bottom: 60, left: 70 };
const INK = "#2b2d42";
const FILL = "#7a9eb1";
const FONT = `font-family="Inter, Helvetica, Arial, sans-serif"`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(+n.toFixed(2)));

/** Which columns the chart uses: first text column as labels, first numeric column as values (second numeric for scatter y). */
export function chooseColumns(t: Table): { label: number; value: number; value2: number } | null {
  const nums = numericColumns(t);
  if (!nums.length) return null;
  const label = t.columns.findIndex((_, i) => !nums.includes(i));
  return { label: label >= 0 ? label : -1, value: nums[0], value2: nums[1] ?? nums[0] };
}

/** tool_4 translate (process 5): table r16 + chart type r17 → chart r18. */
export function renderChart(t: Table, type: ChartType, title = ""): Chart {
  const cols = chooseColumns(t);
  const plot = { x: M.left, y: M.top, w: W - M.left - M.right, h: H - M.top - M.bottom };
  const marks: Chart["marks"] = [];
  const parts: string[] = [];
  if (!cols) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" ${FONT} fill="${INK}">Table needs at least one numeric column</text>`);
  } else {
    const labels = t.rows.map((r, i) => (cols.label >= 0 ? String(r[cols.label]) : `#${i + 1}`));
    const vals = t.rows.map((r) => Number(r[cols.value]));
    const max = niceMax(Math.max(0, ...vals) * 1.15); // headroom for labels / pictographs
    const yAxis = (vmax: number, horizontal = false) => {
      const ticks = 5;
      for (let i = 0; i <= ticks; i++) {
        const v = (vmax / ticks) * i;
        if (!horizontal) {
          const y = plot.y + plot.h - (v / vmax) * plot.h;
          parts.push(`<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}" stroke="#e3e0da"/>`);
          parts.push(`<text x="${plot.x - 8}" y="${y + 4}" text-anchor="end" font-size="11" ${FONT} fill="${INK}">${fmt(v)}</text>`);
        } else {
          const x = plot.x + (v / vmax) * plot.w;
          parts.push(`<line x1="${x}" x2="${x}" y1="${plot.y}" y2="${plot.y + plot.h}" stroke="#e3e0da"/>`);
          parts.push(`<text x="${x}" y="${plot.y + plot.h + 18}" text-anchor="middle" font-size="11" ${FONT} fill="${INK}">${fmt(v)}</text>`);
        }
      }
    };
    if (type === "column") {
      yAxis(max);
      const bw = plot.w / vals.length;
      vals.forEach((v, i) => {
        const h = (Math.max(0, v) / max) * plot.h;
        const m = { x: plot.x + i * bw + bw * 0.15, y: plot.y + plot.h - h, w: bw * 0.7, h, label: labels[i], value: v };
        marks.push(m);
        parts.push(`<rect class="mark" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${FILL}"/>`);
        parts.push(`<text x="${m.x + m.w / 2}" y="${plot.y + plot.h + 18}" text-anchor="middle" font-size="11" ${FONT} fill="${INK}">${escapeXml(labels[i].slice(0, 14))}</text>`);
      });
    } else if (type === "bar") {
      yAxis(max, true);
      const bh = plot.h / vals.length;
      vals.forEach((v, i) => {
        const w = (Math.max(0, v) / max) * plot.w;
        const m = { x: plot.x, y: plot.y + i * bh + bh * 0.15, w, h: bh * 0.7, label: labels[i], value: v };
        marks.push(m);
        parts.push(`<rect class="mark" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${FILL}"/>`);
        parts.push(`<text x="${plot.x - 8}" y="${m.y + m.h / 2 + 4}" text-anchor="end" font-size="11" ${FONT} fill="${INK}">${escapeXml(labels[i].slice(0, 12))}</text>`);
      });
    } else if (type === "line") {
      yAxis(max);
      const step = vals.length > 1 ? plot.w / (vals.length - 1) : 0;
      const pts = vals.map((v, i) => ({ x: plot.x + i * step, y: plot.y + plot.h - (v / max) * plot.h }));
      parts.push(`<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${FILL}" stroke-width="3"/>`);
      pts.forEach((p, i) => {
        marks.push({ x: p.x - 5, y: p.y - 5, w: 10, h: 10, label: labels[i], value: vals[i] });
        parts.push(`<circle class="mark" cx="${p.x}" cy="${p.y}" r="5" fill="${FILL}"/>`);
        parts.push(`<text x="${p.x}" y="${plot.y + plot.h + 18}" text-anchor="middle" font-size="11" ${FONT} fill="${INK}">${escapeXml(labels[i].slice(0, 10))}</text>`);
      });
    } else if (type === "scatter") {
      const xs = vals;
      const ys = t.rows.map((r) => Number(r[cols.value2]));
      const xmax = niceMax(Math.max(0, ...xs));
      const ymax = niceMax(Math.max(0, ...ys));
      yAxis(ymax);
      for (let i = 0; i <= 5; i++) {
        const x = plot.x + (i / 5) * plot.w;
        parts.push(`<text x="${x}" y="${plot.y + plot.h + 18}" text-anchor="middle" font-size="11" ${FONT} fill="${INK}">${fmt((xmax / 5) * i)}</text>`);
      }
      xs.forEach((xv, i) => {
        const cx = plot.x + (xv / xmax) * plot.w;
        const cy = plot.y + plot.h - (ys[i] / ymax) * plot.h;
        marks.push({ x: cx - 6, y: cy - 6, w: 12, h: 12, label: labels[i], value: ys[i] });
        parts.push(`<circle class="mark" cx="${cx}" cy="${cy}" r="6" fill="${FILL}" opacity="0.8"/>`);
      });
      parts.push(`<text x="${plot.x + plot.w / 2}" y="${H - 12}" text-anchor="middle" font-size="12" ${FONT} fill="${INK}">${escapeXml(t.columns[cols.value])}</text>`);
      parts.push(`<text x="16" y="${plot.y + plot.h / 2}" transform="rotate(-90 16 ${plot.y + plot.h / 2})" text-anchor="middle" font-size="12" ${FONT} fill="${INK}">${escapeXml(t.columns[cols.value2])}</text>`);
    } else if (type === "pie") {
      const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      const cx = plot.x + plot.w / 2;
      const cy = plot.y + plot.h / 2;
      const r = Math.min(plot.w, plot.h) / 2 - 10;
      const palette = ["#7a9eb1", "#e07a5f", "#81b29a", "#f2cc8f", "#3d405b", "#c9ada7", "#9a8c98"];
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
        const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
        parts.push(`<path class="mark" d="M${cx},${cy} L${p0.x},${p0.y} A${r},${r} 0 ${large} 1 ${p1.x},${p1.y} Z" fill="${palette[i % palette.length]}" stroke="#fff" stroke-width="2"/>`);
        const am = (a0 + a1) / 2;
        const lx = cx + r * 0.65 * Math.cos(am);
        const ly = cy + r * 0.65 * Math.sin(am);
        marks.push({ x: lx - 20, y: ly - 20, w: 40, h: 40, label: labels[i], value: v });
        if (a1 - a0 > 0.25)
          parts.push(`<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="11" ${FONT} fill="#fff">${escapeXml(labels[i].slice(0, 10))}</text>`);
        a0 = a1;
      });
    }
    if (type !== "pie" && type !== "scatter") {
      parts.push(`<line x1="${plot.x}" x2="${plot.x}" y1="${plot.y}" y2="${plot.y + plot.h}" stroke="${INK}"/>`);
      parts.push(`<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${plot.y + plot.h}" y2="${plot.y + plot.h}" stroke="${INK}"/>`);
    }
  }
  const heading = title || (cols ? t.columns[cols.value] : "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/><text x="${M.left}" y="24" font-size="16" font-weight="700" ${FONT} fill="${INK}">${escapeXml(heading)}</text>${parts.join("")}</svg>`;
  return { svg, width: W, height: H, type, plot, marks };
}
