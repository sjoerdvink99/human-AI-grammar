import type { Anchor, ChartSpec, ComposedChart, Dataset, LayoutKind, Mark, Rect, Segment, SegmentLabel, Variant } from "../types.ts";
import { aggregate, fmt } from "./profile.ts";
import { CANVAS } from "./sanitize.ts";
import { nestSvg } from "./svg.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** tool_3 extract: r13_2* + r14* -> r20* (anchor slots, left-to-right) */
export function anchorsFromSegments(r13: Segment[], r14: SegmentLabel[]): Anchor[] {
  return r13
    .filter((s) => {
      const role = r14.find((l) => l.segmentId === s.id)?.role;
      return role === "mark" || role === "anchor";
    })
    .map((s) => ({ ...s.bbox, segmentId: s.id }))
    .sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
}

/** tool_3 translate: r21 + r19* + r1 -> r22* (one mark per category) */
export function marksFromData(r1: Dataset, r21: ChartSpec, r19: Variant[]): Mark[] {
  const groups = aggregate(r1, r21.categoryField, r21.valueField, r21.valueField ? r21.aggregate : "count");
  const marks: Mark[] = [];
  for (const g of groups) {
    const v = r19.find((x) => x.segmentId === r21.segmentId && x.category === g.category && x.svg);
    if (v?.svg) marks.push({ category: g.category, value: g.value, svg: v.svg });
  }
  if (r21.sort === "asc") marks.sort((a, b) => a.value - b.value);
  if (r21.sort === "desc") marks.sort((a, b) => b.value - a.value);
  return marks;
}

function sizeFor(v: number, max: number, spec: ChartSpec) {
  return spec.minSize + (spec.maxSize - spec.minSize) * Math.sqrt(Math.max(v, 0) / Math.max(max, 1e-9));
}

function autoUnit(marks: Mark[]): number {
  const max = Math.max(...marks.map((m) => m.value), 1);
  const raw = max / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((u) => u >= raw) ?? raw;
}

function wrap(kind: LayoutKind, w: number, h: number, body: string, positions: Record<string, Rect>): ComposedChart {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif"><rect width="${w}" height="${h}" fill="#fffdf8"/>${body}</svg>`;
  return { layout: kind, svg, width: w, height: h, positions, categoryField: "", values: {} };
}

function inPlace(marks: Mark[], anchors: Anchor[], spec: ChartSpec): ComposedChart {
  const W = CANVAS.width,
    H = CANVAS.height + 30;
  const max = Math.max(...marks.map((m) => m.value), 1);
  const slots: { cx: number; cy: number }[] = anchors.map((a) => ({ cx: a.x + a.w / 2, cy: a.y + a.h / 2 }));
  // extra slots along the bottom when there are more categories than anchors
  for (let i = slots.length; i < marks.length; i++) slots.push({ cx: ((i - anchors.length + 0.5) * W) / Math.max(marks.length - anchors.length, 1), cy: H - 70 });
  const positions: Record<string, Rect> = {};
  const parts = marks.map((m, i) => {
    const s = sizeFor(m.value, max, spec);
    const r = { x: slots[i].cx - s / 2, y: slots[i].cy - s / 2, w: s, h: s };
    positions[m.category] = r;
    return `${nestSvg(m.svg, r, `ip${i}-`)}<text x="${slots[i].cx.toFixed(1)}" y="${(r.y + r.h + 12).toFixed(1)}" font-size="10" text-anchor="middle" fill="#333">${esc(m.category)} · ${fmt(m.value)}</text>`;
  });
  return wrap("in-place", W, H, parts.join(""), positions);
}

function isotype(marks: Mark[], spec: ChartSpec): ComposedChart {
  const unit = spec.unitValue > 0 ? spec.unitValue : autoUnit(marks);
  const icon = 26,
    perRow = 14,
    labelW = 100,
    gap = 2;
  let y = 16;
  const positions: Record<string, Rect> = {};
  const parts: string[] = [];
  marks.forEach((m, i) => {
    const n = m.value / unit;
    const full = Math.floor(n);
    const frac = n - full;
    const count = full + (frac > 0.05 ? 1 : 0);
    const rows = Math.max(1, Math.ceil(count / perRow));
    parts.push(`<text x="${labelW - 8}" y="${y + icon * 0.65}" font-size="12" text-anchor="end" fill="#222">${esc(m.category)}</text>`);
    for (let k = 0; k < count; k++) {
      const r = { x: labelW + (k % perRow) * (icon + gap), y: y + Math.floor(k / perRow) * (icon + gap), w: icon, h: icon };
      const isPartial = k === full && frac > 0.05;
      if (isPartial) {
        const cid = `clip-iso-${i}`;
        parts.push(`<clipPath id="${cid}"><rect x="${r.x}" y="${r.y}" width="${(icon * frac).toFixed(1)}" height="${icon}"/></clipPath><g clip-path="url(#${cid})">${nestSvg(m.svg, r, `is${i}-${k}-`)}</g>`);
      } else parts.push(nestSvg(m.svg, r, `is${i}-${k}-`));
    }
    const lastX = labelW + Math.min(count, perRow) * (icon + gap);
    parts.push(`<text x="${lastX + 4}" y="${y + icon * 0.65}" font-size="11" fill="#666">${fmt(m.value)}</text>`);
    positions[m.category] = { x: labelW, y, w: Math.min(count, perRow) * (icon + gap), h: rows * (icon + gap) };
    y += rows * (icon + gap) + 10;
  });
  const W = labelW + perRow * (icon + gap) + 60;
  parts.push(`<text x="${W - 8}" y="${y + 10}" font-size="10" text-anchor="end" fill="#888">1 icon = ${fmt(unit)}</text>`);
  return wrap("isotype", W, y + 20, parts.join(""), positions);
}

function sizedRow(marks: Mark[], spec: ChartSpec): ComposedChart {
  const max = Math.max(...marks.map((m) => m.value), 1);
  const gap = 14;
  const sizes = marks.map((m) => sizeFor(m.value, max, spec));
  const W = sizes.reduce((a, b) => a + b + gap, gap);
  const base = spec.maxSize + 20;
  let x = gap;
  const positions: Record<string, Rect> = {};
  const parts = marks.map((m, i) => {
    const s = sizes[i];
    const r = { x, y: base - s, w: s, h: s };
    positions[m.category] = r;
    x += s + gap;
    return `${nestSvg(m.svg, r, `sr${i}-`, "xMidYMax meet")}<text x="${(r.x + s / 2).toFixed(1)}" y="${base + 14}" font-size="11" text-anchor="middle" fill="#222">${esc(m.category)}</text><text x="${(r.x + s / 2).toFixed(1)}" y="${base + 27}" font-size="10" text-anchor="middle" fill="#666">${fmt(m.value)}</text>`;
  });
  return wrap("sized-row", Math.max(W, 200), base + 36, `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="#ccc"/>${parts.join("")}`, positions);
}

function bars(marks: Mark[], spec: ChartSpec): ComposedChart {
  const unit = spec.unitValue > 0 ? spec.unitValue : autoUnit(marks);
  const icon = 24,
    colW = 54;
  const counts = marks.map((m) => Math.max(1, Math.round(m.value / unit)));
  const maxCount = Math.max(...counts, 1);
  const base = 20 + maxCount * (icon - 4) + icon;
  const positions: Record<string, Rect> = {};
  const parts: string[] = [];
  marks.forEach((m, i) => {
    const cx = 20 + i * colW + colW / 2;
    for (let k = 0; k < counts[i]; k++) {
      parts.push(nestSvg(m.svg, { x: cx - icon / 2, y: base - icon - k * (icon - 4), w: icon, h: icon }, `br${i}-${k}-`));
    }
    const top = base - icon - (counts[i] - 1) * (icon - 4);
    positions[m.category] = { x: cx - icon / 2, y: top, w: icon, h: base - top };
    parts.push(`<text x="${cx}" y="${top - 4}" font-size="10" text-anchor="middle" fill="#666">${fmt(m.value)}</text>`);
    parts.push(`<text x="${cx}" y="${base + 14}" font-size="11" text-anchor="middle" fill="#222">${esc(m.category.slice(0, 9))}</text>`);
  });
  const W = 40 + marks.length * colW;
  parts.push(`<text x="${W - 6}" y="${base + 30}" font-size="10" text-anchor="end" fill="#888">1 icon ≈ ${fmt(unit)}</text>`);
  return wrap("bars", W, base + 36, `<line x1="10" x2="${W - 10}" y1="${base}" y2="${base}" stroke="#ccc"/>${parts.join("")}`, positions);
}

/** tool_3 compose: r22* + r20* + r21 -> r23* (one composed chart per selected layout) */
export function composeCharts(r22: Mark[], r20: Anchor[], r21: ChartSpec): ComposedChart[] {
  if (!r22.length) return [];
  const values = Object.fromEntries(r22.map((m) => [m.category, m.value]));
  return r21.layouts.map((kind) => ({
    ...(kind === "in-place" ? inPlace(r22, r20, r21) : kind === "isotype" ? isotype(r22, r21) : kind === "sized-row" ? sizedRow(r22, r21) : bars(r22, r21)),
    categoryField: r21.categoryField,
    values,
  }));
}
