/** Make every id in an SVG unique by prefixing, rewriting url(#..) and href="#.." references. */
export function prefixIds(svg: string, prefix: string): string {
  const ids = [...svg.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  let s = svg;
  for (const id of new Set(ids)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s
      .replace(new RegExp(`(\\sid\\s*=\\s*")${esc}"`, 'g'), `$1${prefix}-${id}"`)
      .replace(new RegExp(`url\\(\\s*#${esc}\\s*\\)`, 'g'), `url(#${prefix}-${id})`)
      .replace(new RegExp(`(href\\s*=\\s*")#${esc}"`, 'g'), `$1#${prefix}-${id}"`);
  }
  return s;
}

export function viewBoxOf(svg: string): [number, number, number, number] {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  const v = (m ? m[1] : '0 0 256 256').trim().split(/[\s,]+/).map(Number);
  return [v[0] || 0, v[1] || 0, v[2] || 256, v[3] || 256];
}

export function innerOf(svg: string): string {
  const m = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i);
  return m ? m[1] : '';
}

export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not rasterize SVG'));
    img.src = src;
  });
}

export const MASK_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324'];
