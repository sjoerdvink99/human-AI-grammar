// SVG utilities used by the tools (normalisation of model_2 output, rendering, rasterising)
import type { BBox, CandidateImage, GlyphImage, Shape } from '../types';

const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'opacity', 'fill-rule'];
const GEOM_ATTRS = ['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'x1', 'y1', 'x2', 'y2'];

export function sanitizeInBrowser(svgText: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement as unknown as SVGSVGElement;
  if (root.nodeName.toLowerCase() !== 'svg') throw new Error('not an SVG');
  root.querySelectorAll('script,foreignObject,image,text').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  });
  return root;
}

/** Turn a candidate image into the canonical glyph_image: flat list of shapes with baked style and absolute transform. */
export function normalizeGlyphImage(c: CandidateImage): GlyphImage {
  const root = sanitizeInBrowser(c.svg);
  const vb = (root.getAttribute('viewBox') ?? '0 0 256 256').split(/[\s,]+/).map(Number);
  const [minX, minY, width, height] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 256, 256];
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;pointer-events:none';
  host.appendChild(document.importNode(root, true));
  document.body.appendChild(host);
  try {
    const live = host.querySelector('svg') as SVGSVGElement;
    const rootInv = live.getScreenCTM()?.inverse();
    const shapes: Shape[] = [];
    let n = 0;
    live.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (!SHAPE_TAGS.has(tag)) return;
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) return;
      const g = el as SVGGraphicsElement;
      const ctm = g.getScreenCTM();
      const m = rootInv && ctm ? rootInv.multiply(ctm) : new DOMMatrix();
      const cs = getComputedStyle(g);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const b = g.getBBox();
      const pts = [
        [b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const bbox: BBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      const gid = `s${n++}`;
      const attrs: string[] = [`data-gid="${gid}"`];
      for (const a of GEOM_ATTRS) {
        const v = el.getAttribute(a);
        if (v !== null) attrs.push(`${a}="${esc(v)}"`);
      }
      for (const p of STYLE_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) attrs.push(`${p}="${esc(v.replace(/"/g, "'"))}"`);
      }
      attrs.push(`transform="matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(4)).join(' ')})"`);
      shapes.push({ gid, tag, markup: `<${tag} ${attrs.join(' ')}/>`, bbox, fill: cs.getPropertyValue('fill') });
    });
    const defs = [...live.querySelectorAll('linearGradient,radialGradient,pattern,clipPath')]
      .filter((d) => !d.parentElement?.closest('linearGradient,radialGradient,pattern,clipPath'))
      .map((d) => d.outerHTML)
      .join('');
    if (shapes.length === 0) throw new Error('image has no shapes');
    return { sourceId: c.id, concept: c.concept, width, height, minX, minY, defs, shapes };
  } finally {
    host.remove();
  }
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function glyphImageSvg(gi: GlyphImage, shapes: Shape[] = gi.shapes, vb?: BBox): string {
  const v = vb ?? [gi.minX, gi.minY, gi.width, gi.height];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.join(' ')}"><defs>${gi.defs}</defs>${shapes.map((s) => s.markup).join('')}</svg>`;
}

export function unionBox(boxes: BBox[]): BBox {
  if (boxes.length === 0) return [0, 0, 1, 1];
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

export function boxesIntersect(a: BBox, b: BBox): boolean {
  return !(a[0] + a[2] < b[0] || b[0] + b[2] < a[0] || a[1] + a[3] < b[1] || b[1] + b[3] < a[1]);
}

/** Rasterise SVG markup to a PNG (base64, no prefix). */
export async function svgToPng(svg: string, width: number, height: number, background?: string): Promise<Blob> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('could not render SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
