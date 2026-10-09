// tool_3 = image processing: contours, numerical translation, glyph assembly
import type {
  AssemblySettings, Attribute, AttributeMapping, BBox, CategoricalFragment, Dataset, FragmentContour,
  Fragment, GlyphImage, GlyphSet, Mask, NumericalFragment, PartAssembly, Shape, ShapeStyle,
} from '../types';
import { setAttr } from './tool2';
import { unionBox } from './svg';

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];
const tr = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const sc = (s: number): M => [s, 0, 0, s, 0, 0];
const rot = (deg: number): M => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mstr = (m: M) => `matrix(${m.map((v) => +v.toFixed(4)).join(' ')})`;
function transformBox(m: M, b: BBox): BBox {
  const pts = [apply(m, b[0], b[1]), apply(m, b[0] + b[2], b[1]), apply(m, b[0], b[1] + b[3]), apply(m, b[0] + b[2], b[1] + b[3])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** [tool_3 extract] categorical_fragments_1* + masks_2* -> fragment_contours_1* */
export function extractContours(gi: GlyphImage, masks: Mask[]): FragmentContour[] {
  return masks.map((m) => {
    const shapes = gi.shapes.filter((s) => m.gids.includes(s.gid));
    const bbox = unionBox(shapes.map((s) => s.bbox));
    const pts = shapes.flatMap((s): [number, number][] => [
      [s.bbox[0], s.bbox[1]], [s.bbox[0] + s.bbox[2], s.bbox[1]], [s.bbox[0], s.bbox[1] + s.bbox[3]], [s.bbox[0] + s.bbox[2], s.bbox[1] + s.bbox[3]],
    ]);
    return { maskId: m.id, bbox, cx: bbox[0] + bbox[2] / 2, cy: bbox[1] + bbox[3] / 2, outline: hull(pts) };
  });
}

export function defaultAssembly(masks: Mask[], mappings: AttributeMapping[]): AssemblySettings {
  return {
    parts: masks.map((m) => ({
      maskId: m.id,
      mode: 'size' as const,
      minScale: 0.5,
      maxScale: 1.3,
      minCount: 1,
      maxCount: 5,
      spacing: 4,
    })).filter((p) => mappings.some((x) => x.maskId === p.maskId)),
    layerOrder: ['base', ...masks.map((m) => m.id)],
  };
}

export function norm(v: string | undefined, a: Attribute | undefined): number {
  if (!a || v === undefined || v === '' || !Number.isFinite(Number(v))) return 0;
  return a.max === a.min ? 1 : (Number(v) - a.min) / (a.max - a.min);
}

function copyMatrices(p: PartAssembly | undefined, c: FragmentContour, t: number, center: [number, number]): M[] {
  if (!p) return [I];
  if (p.mode === 'size') {
    const s = p.minScale + t * (p.maxScale - p.minScale);
    return [mul(tr(c.cx, c.cy), mul(sc(s), tr(-c.cx, -c.cy)))];
  }
  const count = Math.max(0, Math.round(p.minCount + t * (p.maxCount - p.minCount)));
  const out: M[] = [];
  for (let i = 0; i < count; i++) {
    if (p.mode === 'dup-h') out.push(tr((i - (count - 1) / 2) * (c.bbox[2] + p.spacing), 0));
    else if (p.mode === 'dup-v') out.push(tr(0, -i * (c.bbox[3] + p.spacing)));
    else out.push(mul(tr(center[0], center[1]), mul(rot((i - (count - 1) / 2) * p.spacing * 4), tr(-center[0], -center[1]))));
  }
  return out;
}

/** [tool_3 translate] assembly_settings_1 + contours + dataset -> numerical_fragments_1* */
export function translateNumerical(
  gi: GlyphImage, ds: Dataset, attrs: Attribute[], mappings: AttributeMapping[],
  contours: FragmentContour[], settings: AssemblySettings,
): NumericalFragment[] {
  const center: [number, number] = [gi.minX + gi.width / 2, gi.minY + gi.height / 2];
  const out: NumericalFragment[] = [];
  ds.rows.forEach((row, r) => {
    for (const c of contours) {
      const map = mappings.find((m) => m.maskId === c.maskId);
      const part = map?.numerical ? settings.parts.find((p) => p.maskId === c.maskId) : undefined;
      const t = map?.numerical ? norm(row[map.numerical], attrs.find((a) => a.name === map.numerical)) : 0;
      out.push({ row: r, maskId: c.maskId, transforms: copyMatrices(part, c, t, center).map(mstr) });
    }
  });
  return out;
}

// ---- textures used by categorical fragments
export function patternId(texture: string, color: string) {
  return `tx-${texture}-${color.replace('#', '')}`;
}
export function patternDef(texture: string, color: string): string {
  const id = patternId(texture, color);
  const body: Record<string, string> = {
    stripes: `<path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="${color}" stroke-width="1.4"/>`,
    dots: `<circle cx="3" cy="3" r="1.2" fill="${color}"/>`,
    crosshatch: `<path d="M0 6L6 0M0 0L6 6" stroke="${color}" stroke-width="0.9"/>`,
    waves: `<path d="M0 3Q1.5 0.5 3 3T6 3" fill="none" stroke="${color}" stroke-width="1"/>`,
    grain: `<circle cx="1" cy="1.5" r="0.6" fill="${color}"/><circle cx="4.2" cy="2.4" r="0.5" fill="${color}"/><circle cx="2.5" cy="4.8" r="0.7" fill="${color}"/>`,
  };
  return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse">${body[texture] ?? ''}</pattern>`;
}

/** Render a fragment's shapes with a categorical style set (geometry is never changed). */
export function styledShapes(shapes: Shape[], styles: ShapeStyle[] | undefined, defs: Set<string>): string {
  if (!styles) return shapes.map((s) => s.markup).join('');
  return shapes.map((s) => {
    const st = styles.find((x) => x.gid === s.gid);
    if (!st) return s.markup;
    let m = setAttr(setAttr(s.markup, 'fill', st.fill), 'stroke', st.stroke);
    if (st.texture !== 'none') {
      defs.add(patternDef(st.texture, st.textureColor));
      m += setAttr(setAttr(s.markup, 'fill', `url(#${patternId(st.texture, st.textureColor)})`), 'stroke', 'none');
    }
    return m;
  }).join('');
}

export function categoricalFragmentSvg(f: Fragment, cf: CategoricalFragment | undefined, giDefs: string): string {
  const defs = new Set<string>();
  const body = styledShapes(f.shapes, cf?.styles, defs);
  const b = f.bbox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b[0] - 4} ${b[1] - 4} ${b[2] + 8} ${b[3] + 8}"><defs>${giDefs}${[...defs].join('')}</defs>${body}</svg>`;
}

/** [tool_3 compose] numerical_fragments + categorical_fragments + base -> glyphs_1* */
export function composeGlyphs(
  gi: GlyphImage, ds: Dataset, masks: Mask[], mappings: AttributeMapping[], fragments: Fragment[],
  categorical: CategoricalFragment[], numerical: NumericalFragment[], contours: FragmentContour[], settings: AssemblySettings,
): GlyphSet {
  const masked = new Set(masks.flatMap((m) => m.gids));
  const base = gi.shapes.filter((s) => !masked.has(s.gid));
  const baseBox = base.length ? unionBox(base.map((s) => s.bbox)) : null;
  const defs = new Set<string>();
  const boxes: BBox[] = [];
  const glyphs = ds.rows.map((row, r) => {
    let inner = '';
    for (const layer of settings.layerOrder) {
      if (layer === 'base') {
        inner += base.map((s) => s.markup).join('');
        if (baseBox) boxes.push(baseBox);
        continue;
      }
      const frag = fragments.find((f) => f.maskId === layer);
      const contour = contours.find((c) => c.maskId === layer);
      if (!frag || !contour) continue;
      const map = mappings.find((m) => m.maskId === layer);
      const cat = map?.categorical ? categorical.find((c) => c.maskId === layer && c.value === row[map.categorical!]) : undefined;
      const body = styledShapes(frag.shapes, cat?.styles, defs);
      const nf = numerical.find((n) => n.row === r && n.maskId === layer);
      for (const t of nf?.transforms ?? ['matrix(1 0 0 1 0 0)']) {
        inner += `<g transform="${t}">${body}</g>`;
        const nums = t.slice(7, -1).split(' ').map(Number) as M;
        boxes.push(transformBox(nums, contour.bbox));
      }
    }
    return { row: r, svgInner: inner };
  });
  const u = unionBox(boxes);
  const p = Math.max(u[2], u[3]) * 0.03;
  const side = Math.max(u[2], u[3]) + 2 * p;
  // square viewBox centred on content so all glyphs share one scale
  const viewBox: BBox = [u[0] + u[2] / 2 - side / 2, u[1] + u[3] / 2 - side / 2, side, side];
  return { viewBox, glyphs, defs: gi.defs + [...defs].join('') };
}

export function glyphSvg(set: GlyphSet, i: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${set.viewBox.join(' ')}"><defs>${set.defs}</defs>${set.glyphs[i]?.svgInner ?? ''}</svg>`;
}
