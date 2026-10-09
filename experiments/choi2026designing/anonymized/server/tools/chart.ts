// P3/P5 [tool_5 translate]: r19 word feature table (+ r17 contour for the line) → r20 prosody chart (SVG).
import type { ProsodyFrame, WordFeatureRow } from "../../shared/types.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderProsodyChart(rows: WordFeatureRow[], prosody: ProsodyFrame[], duration: number): string {
  const pxPerSec = 90;
  const W = Math.max(600, Math.ceil(duration * pxPerSec) + 60);
  const H = 240;
  const left = 44;
  const top = 12;
  const pitchH = 130; // pitch band
  const loudTop = top + pitchH + 8;
  const loudH = 36;
  const wordsY = loudTop + loudH + 16;
  const x = (t: number) => left + t * pxPerSec;

  const pitches = prosody.map((f) => f.pitchHz).filter((p): p is number => p !== null);
  const pMin = Math.max(60, Math.floor((pitches.length ? Math.min(...pitches) : 80) / 20) * 20);
  const pMax = Math.min(420, Math.ceil((pitches.length ? Math.max(...pitches) : 300) / 20) * 20);
  const py = (p: number) => top + pitchH - ((p - pMin) / Math.max(1, pMax - pMin)) * pitchH;
  const ly = (db: number) => loudTop + loudH - ((Math.max(-60, db) + 60) / 60) * loudH;

  // Pitch contour as broken polyline (gaps where unvoiced).
  const paths: string[] = [];
  let cur: string[] = [];
  for (const f of prosody) {
    if (f.pitchHz === null) {
      if (cur.length > 1) paths.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(f.t).toFixed(1)},${py(f.pitchHz).toFixed(1)}`);
  }
  if (cur.length > 1) paths.push(cur.join(" "));

  const loudArea =
    `M${x(0)},${loudTop + loudH} ` + prosody.map((f) => `L${x(f.t).toFixed(1)},${ly(f.rmsDb).toFixed(1)}`).join(" ") + ` L${x(duration).toFixed(1)},${loudTop + loudH} Z`;

  const grid: string[] = [];
  for (let p = pMin; p <= pMax; p += Math.max(20, Math.round((pMax - pMin) / 4 / 20) * 20)) {
    grid.push(`<line x1="${left}" x2="${W - 8}" y1="${py(p)}" y2="${py(p)}" class="grid"/><text x="${left - 6}" y="${py(p) + 3}" class="axis" text-anchor="end">${p}</text>`);
  }
  for (let t = 0; t <= duration; t += 1) {
    grid.push(`<text x="${x(t)}" y="${H - 2}" class="axis" text-anchor="middle">${t}s</text>`);
  }

  const words = rows
    .map((r, i) => {
      const cx = (x(r.start) + x(r.end)) / 2;
      const y = wordsY + (i % 2) * 14;
      const pause = r.pauseAfter >= 0.25 ? `<rect x="${x(r.end)}" y="${top}" width="${(r.pauseAfter * pxPerSec).toFixed(1)}" height="${loudTop + loudH - top}" class="pause"><title>pause ${r.pauseAfter.toFixed(2)} s</title></rect>` : "";
      return `${pause}<line x1="${x(r.start)}" x2="${x(r.start)}" y1="${loudTop + loudH}" y2="${y - 9}" class="tick"/><text x="${cx.toFixed(1)}" y="${y}" class="word" text-anchor="middle"><title>${esc(r.word)} — ${r.start.toFixed(2)}–${r.end.toFixed(2)} s, ${r.pitchHz ?? "–"} Hz, ${r.loudnessDb} dB</title>${esc(r.word)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pitch and loudness over time with aligned words">
<style>.grid{stroke:#e5e7eb}.axis{font:10px system-ui;fill:#6b7280}.word{font:11px system-ui;fill:#111827}.tick{stroke:#d1d5db}.pitch{fill:none;stroke:#2563eb;stroke-width:1.8}.loud{fill:#a7f3d0;stroke:#10b981;stroke-width:.8}.pause{fill:#fde68a;opacity:.45}.lbl{font:600 10px system-ui;fill:#374151}</style>
${grid.join("")}
${words}
<path d="${loudArea}" class="loud"/>
${paths.map((p) => `<polyline points="${p}" class="pitch"/>`).join("")}
<text x="4" y="${top + 8}" class="lbl">Hz</text><text x="4" y="${loudTop + 20}" class="lbl">dB</text>
</svg>`;
}
