// tool_1 helpers for the visual medium: sanitize model SVG, normalize ids, rasterize, crop, render masks.
import { Resvg } from '@resvg/resvg-js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { IMAGE_SIZE, type ImageArtifact } from '../shared/types.ts';
import { newId } from './util.ts';

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const NON_RENDER = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'marker', 'linearGradient', 'radialGradient', 'filter', 'metadata', 'title', 'desc', 'style']);
const FORBIDDEN = new Set(['script', 'foreignObject', 'image', 'iframe', 'audio', 'video', 'text', 'tspan', 'textPath']);

type El = any; // xmldom Element

function parse(svg: string): El {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== 'warning') errors.push(msg);
    },
  } as any).parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg' || errors.length) throw new Error('Invalid SVG: ' + (errors[0] ?? 'no <svg> root'));
  return doc;
}
const serialize = (doc: El) => new XMLSerializer().serializeToString(doc);

function children(el: El): El[] {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
  return out;
}
function walk(el: El, fn: (e: El, insideNonRender: boolean) => void, inside = false) {
  for (const c of children(el)) {
    const nr = inside || NON_RENDER.has(c.nodeName);
    fn(c, nr);
    walk(c, fn, nr);
  }
}

/** Sanitize and normalize: strip unsafe nodes, map into a 512×512 viewBox, ensure every shape/group has a unique id. */
export function normalizeSvg(svg: string): string {
  const m = svg.match(/<svg[\s\S]*<\/svg>/);
  if (!m) throw new Error('No <svg> element in output');
  const doc = parse(m[0]);
  const root = doc.documentElement;
  // strip unsafe
  const toRemove: El[] = [];
  walk(root, (e) => {
    if (FORBIDDEN.has(e.nodeName)) toRemove.push(e);
    for (const a of Array.from(e.attributes ?? []) as any[]) {
      if (/^on/i.test(a.name)) e.removeAttribute(a.name);
      if (/href$/i.test(a.name) && !String(a.value).startsWith('#')) e.removeAttribute(a.name);
      if (a.name === 'filter' || a.name === 'mask') e.removeAttribute(a.name);
    }
  });
  toRemove.forEach((e) => e.parentNode?.removeChild(e));
  // map into 0 0 512 512
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let [vx, vy, vw, vh] = vb.length === 4 && vb.every((v: number) => Number.isFinite(v)) ? vb : [0, 0, parseFloat(root.getAttribute('width')) || IMAGE_SIZE, parseFloat(root.getAttribute('height')) || IMAGE_SIZE];
  if (!(vx === 0 && vy === 0 && vw === IMAGE_SIZE && vh === IMAGE_SIZE)) {
    const s = Math.min(IMAGE_SIZE / vw, IMAGE_SIZE / vh);
    const tx = (IMAGE_SIZE - vw * s) / 2 - vx * s;
    const ty = (IMAGE_SIZE - vh * s) / 2 - vy * s;
    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(5)})`);
    for (const c of children(root)) if (!NON_RENDER.has(c.nodeName) || c.nodeName === 'style') g.appendChild(c);
    root.appendChild(g);
  }
  root.setAttribute('viewBox', `0 0 ${IMAGE_SIZE} ${IMAGE_SIZE}`);
  root.setAttribute('width', String(IMAGE_SIZE));
  root.setAttribute('height', String(IMAGE_SIZE));
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // ids
  const seen = new Set<string>();
  let n = 0;
  walk(root, (e, nr) => {
    if (nr) return;
    if (!SHAPES.has(e.nodeName) && e.nodeName !== 'g') return;
    let id = e.getAttribute('id');
    if (!id || seen.has(id)) {
      do id = `s${++n}`;
      while (seen.has(id));
      e.setAttribute('id', id);
    }
    seen.add(id);
  });
  const out = serialize(doc);
  renderPixels(out); // throws if resvg cannot render
  return out;
}

export function listShapeIds(svg: string): string[] {
  const doc = parse(svg);
  const ids: string[] = [];
  walk(doc.documentElement, (e, nr) => {
    if (!nr && (SHAPES.has(e.nodeName) || e.nodeName === 'g') && e.getAttribute('id')) ids.push(e.getAttribute('id'));
  });
  return ids;
}

export function renderPixels(svg: string, background = 'white'): { pixels: Buffer; width: number; height: number } {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: IMAGE_SIZE }, background, font: { loadSystemFonts: false } }).render();
  return { pixels: r.pixels, width: r.width, height: r.height };
}

export function renderPng(svg: string, width = IMAGE_SIZE, background = 'white'): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, background, font: { loadSystemFonts: false } }).render().asPng();
}

export function toImageArtifact(svg: string, note?: string): ImageArtifact {
  const norm = normalizeSvg(svg);
  return { id: newId('img'), svg: norm, png: 'data:image/png;base64,' + renderPng(norm).toString('base64'), note, createdAt: Date.now() };
}

/** Remove shapes by id (used to enforce that removed items are really gone from the work image). */
export function removeIds(svg: string, ids: string[]): string {
  const doc = parse(svg);
  const set = new Set(ids);
  const rm: El[] = [];
  walk(doc.documentElement, (e) => {
    if (set.has(e.getAttribute?.('id'))) rm.push(e);
  });
  rm.forEach((e) => e.parentNode?.removeChild(e));
  return serialize(doc);
}

/** Render a binary mask (Uint8Array, 512×512) of the shapes with the given ids. */
export function renderIdMask(svg: string, ids: string[]): Uint8Array {
  const doc = parse(svg);
  const root = doc.documentElement;
  const sel = new Set(ids);
  const isSelected = (e: El): boolean => {
    for (let p = e; p && p !== root; p = p.parentNode) if (sel.has(p.getAttribute?.('id'))) return true;
    return false;
  };
  walk(root, (e, nr) => {
    if (nr || !SHAPES.has(e.nodeName)) return;
    if (!isSelected(e)) {
      e.setAttribute('display', 'none');
      return;
    }
    const style = (e.getAttribute('style') || '') + ';' + (e.getAttribute('fill') ? `fill:${e.getAttribute('fill')}` : '');
    const fillNone = /fill\s*:\s*none/.test(style) || e.getAttribute('fill') === 'none';
    e.setAttribute('style', `${fillNone ? 'fill:none' : 'fill:#000'};stroke:${hasStroke(e) ? '#000' : 'none'};opacity:1;fill-opacity:1;stroke-opacity:1`);
  });
  const { pixels } = renderPixels(serialize(doc));
  const mask = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE);
  for (let i = 0; i < mask.length; i++) {
    const lum = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
    mask[i] = lum < 128 ? 1 : 0;
  }
  return mask;
}

function hasStroke(e: El): boolean {
  const attr = e.getAttribute('stroke');
  const st = (e.getAttribute('style') || '').match(/stroke\s*:\s*([^;]+)/);
  const v = (st ? st[1] : attr || '').trim();
  return !!v && v !== 'none';
}

/** Crop an SVG to a region by changing its viewBox (tool_1 extract → element_crop). */
export function cropSvg(svg: string, box: { x: number; y: number; w: number; h: number }): string {
  const doc = parse(svg);
  const root = doc.documentElement;
  const side = Math.max(box.w, box.h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  root.setAttribute('viewBox', `${(cx - side / 2).toFixed(1)} ${(cy - side / 2).toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`);
  return serialize(doc);
}

/** Estimate the dominant colour of the image corners/edges (used for the backboard). */
export function dominantColor(svg: string): string {
  const { pixels } = renderPixels(svg);
  const counts = new Map<string, number>();
  for (let y = 0; y < IMAGE_SIZE; y += 8)
    for (let x = 0; x < IMAGE_SIZE; x += 8) {
      const i = (y * IMAGE_SIZE + x) * 4;
      const key = [0, 1, 2].map((k) => Math.round(pixels[i + k] / 32) * 32).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  let best = 'cccccc';
  let bn = 0;
  for (const [k, v] of counts) if (v > bn) (best = k), (bn = v);
  return '#' + best;
}

/** Average colour of the image under a mask. */
export function meanColor(svg: string, mask: Uint8Array): string {
  const { pixels } = renderPixels(svg);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      r += pixels[i * 4];
      g += pixels[i * 4 + 1];
      b += pixels[i * 4 + 2];
      n++;
    }
  if (!n) return '#888888';
  return '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
}

/** tool_1 extract: mask of everything that differs from the (near-white) background of an isolated-element image. */
export function foregroundMask(svg: string): Uint8Array {
  const { pixels } = renderPixels(svg);
  const mask = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE);
  // background = colour at the corners
  const c = [0, 1, 2].map((k) => pixels[k]);
  for (let i = 0; i < mask.length; i++) {
    const d = Math.abs(pixels[i * 4] - c[0]) + Math.abs(pixels[i * 4 + 1] - c[1]) + Math.abs(pixels[i * 4 + 2] - c[2]);
    mask[i] = d > 40 ? 1 : 0;
  }
  return mask;
}

/** Fill colour (#rrggbb) of the largest of the given shapes, read from the SVG itself; undefined if not a plain colour. */
export function fillOfIds(svg: string, ids: string[]): string | undefined {
  const doc = parse(svg);
  const byId = new Map<string, El>();
  walk(doc.documentElement, (e) => {
    const id = e.getAttribute?.('id');
    if (id) byId.set(id, e);
  });
  let best: { color: string; area: number } | undefined;
  for (const id of ids) {
    const el = byId.get(id);
    if (!el) continue;
    // a group: look at its shape children
    const shapes: El[] = SHAPES.has(el.nodeName) ? [el] : [];
    if (!shapes.length) walk(el, (c, nr) => !nr && SHAPES.has(c.nodeName) && shapes.push(c));
    for (const s of shapes) {
      const color = resolveFill(s);
      const sid = s.getAttribute('id');
      if (!color || !sid) continue;
      let a = 0;
      const m = renderIdMask(svg, [sid]);
      for (let i = 0; i < m.length; i++) a += m[i];
      if (!best || a > best.area) best = { color, area: a };
    }
  }
  return best?.color;
}

function resolveFill(e: El): string | undefined {
  for (let p = e; p && p.getAttribute; p = p.parentNode) {
    const st = (p.getAttribute('style') || '').match(/fill\s*:\s*([^;]+)/);
    const v = (st ? st[1] : p.getAttribute('fill') || '').trim();
    if (!v) continue;
    const m3 = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    return undefined; // gradients, named colours, none
  }
  return undefined;
}
