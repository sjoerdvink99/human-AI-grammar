import type { AutoPlacement, Chart, Placement } from "./types";

/** Fit a w×h cutout into a box, keeping aspect ratio, centred. */
export function fitInto(cw: number, ch: number, box: { x: number; y: number; w: number; h: number }): Placement {
  const s = Math.min(box.w / cw, box.h / ch);
  const w = cw * s;
  const h = ch * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Automatic placement used by process 6 (no human placement step):
 * - "marks": one copy of the cutout on top of every data mark (pictograph decoration)
 * - "corner": one copy in the top-right of the plot area
 * - "background": one large faded copy behind the plot
 */
export function autoPlacements(chart: Chart, cw: number, ch: number, mode: AutoPlacement): { p: Placement; opacity: number; behind: boolean }[] {
  const { plot } = chart;
  if (mode === "marks" && chart.marks.length) {
    return chart.marks.map((m) => {
      const size = Math.max(24, Math.min(64, chart.type === "bar" ? m.h * 1.2 : m.w * 1.2));
      const box =
        chart.type === "bar"
          ? { x: m.x + m.w + 4, y: m.y + m.h / 2 - size / 2, w: size, h: size }
          : chart.type === "column"
            ? { x: m.x + m.w / 2 - size / 2, y: m.y - size - 4, w: size, h: size }
            : { x: m.x + m.w / 2 - size / 2, y: m.y + m.h / 2 - size / 2, w: size, h: size };
      return { p: fitInto(cw, ch, box), opacity: 1, behind: false };
    });
  }
  if (mode === "background") {
    return [{ p: fitInto(cw, ch, { x: plot.x + plot.w * 0.1, y: plot.y + plot.h * 0.05, w: plot.w * 0.8, h: plot.h * 0.9 }), opacity: 0.18, behind: true }];
  }
  const size = Math.min(plot.w, plot.h) * 0.3;
  return [{ p: fitInto(cw, ch, { x: plot.x + plot.w - size, y: plot.y, w: size, h: size }), opacity: 1, behind: false }];
}

/**
 * tool_6 compose (processes 6 & 7): chart r18 + cutout r22/r27 (+ placement r28) → pictorial chart r23/r29.
 * The cutout is embedded as a PNG data URL so the result is a self-contained SVG.
 */
export function composePictorial(
  chart: Chart,
  cutout: { dataUrl: string; width: number; height: number },
  placements: { p: Placement; opacity: number; behind: boolean }[],
): string {
  const img = (pl: { p: Placement; opacity: number }) =>
    `<image href="${cutout.dataUrl}" x="${pl.p.x}" y="${pl.p.y}" width="${pl.p.w}" height="${pl.p.h}" opacity="${pl.opacity}" preserveAspectRatio="xMidYMid meet"/>`;
  const inner = chart.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  // background rect is the first element; keep it first, then "behind" images, then chart, then front images
  const bgMatch = inner.match(/^<rect width="100%" height="100%"[^>]*\/>/);
  const bg = bgMatch ? bgMatch[0] : "";
  const rest = bgMatch ? inner.slice(bg.length) : inner;
  const behind = placements.filter((p) => p.behind).map(img).join("");
  const front = placements.filter((p) => !p.behind).map(img).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${chart.width}" height="${chart.height}" viewBox="0 0 ${chart.width} ${chart.height}">${bg}${behind}${rest}${front}</svg>`;
}

/** Point-in-polygon (even-odd), used by tool_5 when masking. */
export function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Bounding box of a polygon. */
export function polygonBounds(poly: { x: number; y: number }[]) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
