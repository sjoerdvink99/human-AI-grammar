// tool_1 (image processing, mask conversion): deterministic raster utilities.
import sharp from 'sharp';
import type { Box } from '../../shared/types.js';

export interface RGBA {
  data: Uint8ClampedArray | Buffer;
  width: number;
  height: number;
}
export type Mask = Uint8Array; // 0 / 1 per pixel

export const MAX_SIDE = 768;

/** Normalize any uploaded/generated image to PNG with the long side <= MAX_SIDE. */
export async function normalizeImage(buf: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const img = sharp(buf, { density: 144 }).rotate().flatten({ background: '#ffffff' });
  const meta = await img.metadata();
  const w = meta.width ?? MAX_SIDE;
  const h = meta.height ?? MAX_SIDE;
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const png = await img.resize(Math.round(w * s), Math.round(h * s)).png().toBuffer();
  const m2 = await sharp(png).metadata();
  return { png, width: m2.width!, height: m2.height! };
}

export async function loadRGBA(file: string | Buffer): Promise<RGBA> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function saveRGBA(img: RGBA, file: string) {
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png()
    .toFile(file);
}

export async function saveMask(mask: Mask, width: number, height: number, file: string) {
  const g = Buffer.alloc(width * height);
  for (let i = 0; i < mask.length; i++) g[i] = mask[i] ? 255 : 0;
  await sharp(g, { raw: { width, height, channels: 1 } }).png().toFile(file);
}

export async function loadMask(file: string): Promise<{ mask: Mask; width: number; height: number }> {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * info.channels] > 127 ? 1 : 0;
  return { mask, width: info.width, height: info.height };
}

/** Rasterize an SVG document to RGBA at the given size. */
export async function rasterizeSvg(svg: string, width: number, height: number): Promise<RGBA> {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 })
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Rasterize polygons (pixel coordinates) into a mask. */
export async function polygonsToMask(polys: [number, number][][], width: number, height: number): Promise<Mask> {
  const d = polys
    .filter((p) => p.length >= 3)
    .map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z')
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${d}" fill="#fff" fill-rule="nonzero"/></svg>`;
  return alphaToMask(await rasterizeSvg(svg, width, height));
}

export function alphaToMask(img: RGBA): Mask {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

/** Image differencing against a uniform background colour (process 5, 6, 8). */
export function diffMask(img: RGBA, bg: [number, number, number] = [255, 255, 255], threshold = 40): Mask {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) {
    const a = img.data[i * 4 + 3];
    if (a < 128) continue;
    const dr = img.data[i * 4] - bg[0];
    const dg = img.data[i * 4 + 1] - bg[1];
    const db = img.data[i * 4 + 2] - bg[2];
    if (Math.sqrt(dr * dr + dg * dg + db * db) > threshold) m[i] = 1;
  }
  return fillHoles(closeMask(m, img.width, img.height, 2), img.width, img.height);
}

/** Estimate the background colour from the image border. */
export function borderColor(img: RGBA): [number, number, number] {
  const acc = [0, 0, 0];
  let n = 0;
  const { width: w, height: h, data } = img;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    acc[0] += data[i];
    acc[1] += data[i + 1];
    acc[2] += data[i + 2];
    n++;
  };
  for (let x = 0; x < w; x += 2) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    add(0, y);
    add(w - 1, y);
  }
  return [acc[0] / n, acc[1] / n, acc[2] / n];
}

// ---------- morphology ----------

/** Exact squared Euclidean distance transform (Felzenszwalb). Distance to nearest pixel where `target` is 1. */
export function edt(target: Mask, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float32Array(Math.max(w, h));
  const d = new Float32Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float32Array(Math.max(w, h) + 1);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = target[i] ? 0 : INF;
  const pass = (n: number, get: (i: number) => number, set: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let i = 0; i < n; i++) set(i, d[i]);
  };
  for (let x = 0; x < w; x++) pass(h, (y) => out[y * w + x], (y, val) => (out[y * w + x] = val));
  for (let y = 0; y < h; y++) pass(w, (x) => out[y * w + x], (x, val) => (out[y * w + x] = val));
  return out;
}

export function dilate(m: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return m.slice();
  const d = edt(m, w, h);
  const out = new Uint8Array(m.length);
  const r2 = r * r;
  for (let i = 0; i < m.length; i++) out[i] = d[i] <= r2 ? 1 : 0;
  return out;
}
export function erode(m: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return m.slice();
  const inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = edt(inv, w, h);
  const out = new Uint8Array(m.length);
  const r2 = r * r;
  for (let i = 0; i < m.length; i++) out[i] = m[i] && d[i] > r2 ? 1 : 0;
  return out;
}
export const openMask = (m: Mask, w: number, h: number, r: number) => dilate(erode(m, w, h, r), w, h, r);
export const closeMask = (m: Mask, w: number, h: number, r: number) => erode(dilate(m, w, h, r), w, h, r);

export interface Component {
  label: number;
  area: number;
  box: Box;
  cx: number;
  cy: number;
}

/** 8-connected component labelling. */
export function components(m: Mask, w: number, h: number): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(m.length);
  const comps: Component[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || labels[i]) continue;
    const c: Component = { label: next, area: 0, box: [w, h, 0, 0], cx: 0, cy: 0 };
    labels[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.cx += x;
      c.cy += y;
      if (x < c.box[0]) c.box[0] = x;
      if (y < c.box[1]) c.box[1] = y;
      if (x + 1 > c.box[2]) c.box[2] = x + 1;
      if (y + 1 > c.box[3]) c.box[3] = y + 1;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (m[q] && !labels[q]) {
            labels[q] = next;
            stack.push(q);
          }
        }
    }
    c.cx /= c.area;
    c.cy /= c.area;
    comps.push(c);
    next++;
  }
  return { labels, comps };
}

/** Fill enclosed holes (background components not touching the border). */
export function fillHoles(m: Mask, w: number, h: number): Mask {
  const inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const { labels, comps } = components(inv, w, h);
  const outside = new Set<number>();
  for (const c of comps) if (c.box[0] === 0 || c.box[1] === 0 || c.box[2] === w || c.box[3] === h) outside.add(c.label);
  const out = m.slice();
  for (let i = 0; i < m.length; i++) if (inv[i] && !outside.has(labels[i])) out[i] = 1;
  return out;
}

/** Remove specks smaller than minArea pixels. */
export function removeSmall(m: Mask, w: number, h: number, minArea: number): Mask {
  const { labels, comps } = components(m, w, h);
  const keep = new Set(comps.filter((c) => c.area >= minArea).map((c) => c.label));
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) if (m[i] && keep.has(labels[i])) out[i] = 1;
  return out;
}

export function maskBox(m: Mask, w: number, h: number): Box | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

export function maskArea(m: Mask) {
  let a = 0;
  for (let i = 0; i < m.length; i++) a += m[i];
  return a;
}

export function boxIoU(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

/** Push-pull hole filling: a smooth deterministic pre-fill of masked pixels from their surroundings. */
export function pushPullFill(img: RGBA, hole: Mask): RGBA {
  const { width: w, height: h } = img;
  type Level = { w: number; h: number; c: Float32Array; wt: Float32Array };
  const base: Level = { w, h, c: new Float32Array(w * h * 3), wt: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    if (hole[i]) continue;
    base.wt[i] = 1;
    for (let k = 0; k < 3; k++) base.c[i * 3 + k] = img.data[i * 4 + k];
  }
  const levels: Level[] = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const p = levels.at(-1)!;
    const nw = Math.max(1, Math.ceil(p.w / 2));
    const nh = Math.max(1, Math.ceil(p.h / 2));
    const L: Level = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), wt: new Float32Array(nw * nh) };
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const i = y * p.w + x;
        const j = (y >> 1) * nw + (x >> 1);
        const wt = p.wt[i];
        if (!wt) continue;
        L.wt[j] += wt;
        for (let k = 0; k < 3; k++) L.c[j * 3 + k] += p.c[i * 3 + k];
      }
    // normalize to premultiplied average with weight capped at 1
    for (let j = 0; j < nw * nh; j++) {
      if (L.wt[j] > 0) {
        for (let k = 0; k < 3; k++) L.c[j * 3 + k] /= L.wt[j];
        L.wt[j] = Math.min(1, L.wt[j]);
        for (let k = 0; k < 3; k++) L.c[j * 3 + k] *= L.wt[j];
      }
    }
    levels.push(L);
  }
  for (let li = levels.length - 2; li >= 0; li--) {
    const L = levels[li];
    const P = levels[li + 1];
    for (let y = 0; y < L.h; y++)
      for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x;
        const j = (y >> 1) * P.w + (x >> 1);
        const a = L.wt[i];
        if (a >= 1) continue;
        const pw = P.wt[j] || 1e-6;
        for (let k = 0; k < 3; k++) L.c[i * 3 + k] = L.c[i * 3 + k] + (1 - a) * (P.c[j * 3 + k] / pw);
        L.wt[i] = 1;
        // after this, c is straight colour (weight 1)
      }
    // convert unaffected premultiplied (weight already 1) - nothing to do
  }
  const out = Buffer.from(img.data);
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.max(0, Math.min(255, base.c[i * 3 + k]));
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** Composite `top` over `bottom` only where `mask` is set (feathered by blur radius). */
export function compositeMasked(bottom: RGBA, top: RGBA, mask: Mask): RGBA {
  const out = Buffer.from(bottom.data);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const a = top.data[i * 4 + 3] / 255;
    if (a <= 0) continue;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(top.data[i * 4 + k] * a + out[i * 4 + k] * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: bottom.width, height: bottom.height };
}

/** Paint masked pixels with a flat colour (used to show models the removed region). */
export function paintMask(img: RGBA, mask: Mask, color: [number, number, number]): RGBA {
  const out = Buffer.from(img.data);
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      out[i * 4] = color[0];
      out[i * 4 + 1] = color[1];
      out[i * 4 + 2] = color[2];
      out[i * 4 + 3] = 255;
    }
  return { data: out, width: img.width, height: img.height };
}

/** Crop an RGBA image and a mask to `box`, producing a texture with alpha from the mask. */
export function cutout(img: RGBA, mask: Mask, box: Box): RGBA {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x + x0;
      const sy = y + y0;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = sy * img.width + sx;
      const di = (y * w + x) * 4;
      if (!mask[si]) continue;
      out[di] = img.data[si * 4];
      out[di + 1] = img.data[si * 4 + 1];
      out[di + 2] = img.data[si * 4 + 2];
      out[di + 3] = 255;
    }
  return { data: out, width: w, height: h };
}

export function cropMask(mask: Mask, w: number, box: Box, h = Infinity): Mask {
  const [x0, y0, x1, y1] = box;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = x + x0;
      const sy = y + y0;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      out[y * cw + x] = mask[sy * w + sx];
    }
  return out;
}

export function cropRGBA(img: RGBA, box: Box): RGBA {
  const full = new Uint8Array(img.width * img.height).fill(1);
  const c = cutout(img, full, box);
  return c;
}

export function clampBox(b: Box, w: number, h: number): Box {
  return [
    Math.max(0, Math.floor(Math.min(b[0], b[2]))),
    Math.max(0, Math.floor(Math.min(b[1], b[3]))),
    Math.min(w, Math.ceil(Math.max(b[0], b[2]))),
    Math.min(h, Math.ceil(Math.max(b[1], b[3]))),
  ];
}
export function padBox(b: Box, pad: number, w: number, h: number): Box {
  return clampBox([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], w, h);
}

/**
 * Snap a rough mask to colour boundaries: pixels in a band of width r around the outline are
 * re-assigned by comparing colour histograms of the sure-inside and sure-outside regions.
 */
export function snapToEdges(img: RGBA, rough: Mask, box: Box, r: number): Mask {
  const { width: w, height: h } = img;
  const inner = erode(rough, w, h, r);
  const outer = dilate(rough, w, h, r);
  const bins = 4096;
  const fg = new Float32Array(bins);
  const bg = new Float32Array(bins);
  const bin = (i: number) => ((img.data[i * 4] >> 4) << 8) | ((img.data[i * 4 + 1] >> 4) << 4) | (img.data[i * 4 + 2] >> 4);
  const [x0, y0, x1, y1] = padBox(box, 2 * r, w, h);
  let nf = 0,
    nb = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (inner[i]) {
        fg[bin(i)]++;
        nf++;
      } else if (!outer[i]) {
        bg[bin(i)]++;
        nb++;
      }
    }
  if (nf < 20 || nb < 20) return rough;
  const out = rough.slice();
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (inner[i] || !outer[i]) continue;
      const b = bin(i);
      const pf = (fg[b] + 0.5) / nf;
      const pb = (bg[b] + 0.5) / nb;
      out[i] = pf > pb ? 1 : 0;
    }
  // keep only pieces connected to the sure-inside region
  const { labels } = components(out, w, h);
  const keep = new Set<number>();
  for (let i = 0; i < out.length; i++) if (inner[i] && labels[i]) keep.add(labels[i]);
  for (let i = 0; i < out.length; i++) if (out[i] && !keep.has(labels[i]) && !rough[i]) out[i] = 0;
  return fillHoles(closeMask(out, w, h, 1), w, h);
}
