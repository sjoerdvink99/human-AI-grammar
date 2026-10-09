import type { BBox, Fragment, Mask, AttributeMapping, Region } from '../types';

export interface ElementInfo { eid: string; tag: string; fill: string; bbox: [number, number, number, number] }
/** Draw order of the glyph: base markup interleaved with mask slots. */
export type SkeletonItem = { kind: 'base'; markup: string } | { kind: 'mask'; maskId: string };
export interface Skeleton { defs: string; viewBox: string; order: SkeletonItem[] }

/** Render an SVG string into a hidden, laid-out DOM node so getBBox / getScreenCTM work. */
export function withRenderedSvg<T>(svg: string, fn: (root: SVGSVGElement) => T): T {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:256px;height:256px;visibility:hidden';
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    const root = host.querySelector('svg') as SVGSVGElement;
    root.setAttribute('width', '256');
    root.setAttribute('height', '256');
    return fn(root);
  } finally {
    host.remove();
  }
}

function toRootMatrix(root: SVGSVGElement, el: SVGGraphicsElement): DOMMatrix {
  const r = root.getScreenCTM();
  const e = el.getScreenCTM();
  if (!r || !e) return new DOMMatrix();
  return DOMMatrix.fromMatrix(r).inverse().multiply(DOMMatrix.fromMatrix(e));
}

function transformedBBox(el: SVGGraphicsElement, m: DOMMatrix): BBox {
  const b = el.getBBox();
  const pts = [
    new DOMPoint(b.x, b.y), new DOMPoint(b.x + b.width, b.y),
    new DOMPoint(b.x, b.y + b.height), new DOMPoint(b.x + b.width, b.y + b.height),
  ].map((p) => p.matrixTransform(m));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function union(a: BBox | null, b: BBox): BBox {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Flattened markup of one element in root (viewBox) coordinates. */
function flatMarkup(root: SVGSVGElement, el: SVGGraphicsElement): string {
  const m = toRootMatrix(root, el);
  const clone = el.cloneNode(true) as Element;
  clone.removeAttribute('transform');
  // carry inherited presentation attributes from ancestor groups
  const inherited: string[] = [];
  for (let p = el.parentElement; p && p !== (root as Element); p = p.parentElement) {
    for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity']) {
      const v = p.getAttribute(attr);
      if (v && !clone.hasAttribute(attr) && !inherited.some((s) => s.startsWith(attr + '='))) inherited.push(`${attr}="${v}"`);
    }
  }
  const html = new XMLSerializer().serializeToString(clone).replace(/\sxmlns="[^"]*"/g, '');
  const tr = `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(4)).join(' ')})`;
  return `<g transform="${tr}" ${inherited.join(' ')}>${html}</g>`;
}

/** Info for the segmenter: each shape's tag, fill and bbox in viewBox units. */
export function elementInfos(svg: string): ElementInfo[] {
  return withRenderedSvg(svg, (root) =>
    [...root.querySelectorAll<SVGGraphicsElement>('[data-eid]')].map((el) => {
      const b = transformedBBox(el, toRootMatrix(root, el));
      return {
        eid: el.getAttribute('data-eid')!, tag: el.tagName, fill: el.getAttribute('fill') || '',
        bbox: [b.x, b.y, b.w, b.h],
      };
    }),
  );
}

/** Fallback-free helper for regions: which elements' centres fall inside a region. */
export function elementsInRegion(infos: ElementInfo[], r: Region): string[] {
  return infos
    .filter((e) => {
      const cx = e.bbox[0] + e.bbox[2] / 2, cy = e.bbox[1] + e.bbox[3] / 2;
      return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    })
    .map((e) => e.eid);
}

/**
 * [tool_2 extract] glyph_image_1 + masks_2* + attribute_mappings_1* -> fragments_1* + fragment_edges_1*
 * Also returns the glyph skeleton (draw order) used later by [tool_3 compose].
 */
export function extractFragments(
  svg: string, masks: Mask[], mappings: AttributeMapping[],
): { fragments: Fragment[]; skeleton: Skeleton } {
  return withRenderedSvg(svg, (root) => {
    const mapped = masks.filter((m) => mappings.some((x) => x.maskId === m.id) && m.eids.length);
    const owner = new Map<string, string>();
    mapped.forEach((m) => m.eids.forEach((e) => owner.set(e, m.id)));
    const defs = [...root.querySelectorAll('defs')].map((d) => d.innerHTML).join('');
    const vb = root.getAttribute('viewBox') || '0 0 256 256';
    const order: SkeletonItem[] = [];
    const seen = new Set<string>();
    const inner = new Map<string, string>();
    const edges = new Map<string, BBox | null>();
    for (const el of root.querySelectorAll<SVGGraphicsElement>('[data-eid]')) {
      const eid = el.getAttribute('data-eid')!;
      const markup = flatMarkup(root, el);
      const mid = owner.get(eid);
      if (!mid) { order.push({ kind: 'base', markup }); continue; }
      if (!seen.has(mid)) { seen.add(mid); order.push({ kind: 'mask', maskId: mid }); }
      inner.set(mid, (inner.get(mid) || '') + markup);
      edges.set(mid, union(edges.get(mid) || null, transformedBBox(el, toRootMatrix(root, el))));
    }
    const fragments: Fragment[] = mapped.map((m) => {
      const e = edges.get(m.id) || { x: 0, y: 0, w: 1, h: 1 };
      const pad = 2;
      const edge = { x: e.x - pad, y: e.y - pad, w: e.w + 2 * pad, h: e.h + 2 * pad };
      const vbs = [edge.x, edge.y, edge.w, edge.h].map((v) => +v.toFixed(2)).join(' ');
      const content = inner.get(m.id) || '';
      return {
        maskId: m.id,
        name: m.name,
        attribute: mappings.filter((x) => x.maskId === m.id).map((x) => x.attribute).join(' + '),
        inner: content,
        edge,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbs}">${defs ? `<defs>${defs}</defs>` : ''}${content}</svg>`,
      };
    });
    return { fragments, skeleton: { defs, viewBox: vb, order } };
  });
}
