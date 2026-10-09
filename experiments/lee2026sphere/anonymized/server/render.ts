// tool_2 translate (process 3): asset records → r29 visual (SVG thumbnails).
import type { Asset, Library } from '../shared/types.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Shape { x: number; y: number; w: number; h: number; rot: number; color: string; shape: 'rect' | 'circle'; label: string }

export function shapesSvg(shapes: Shape[], size = 160): string {
  if (!shapes.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"/>`;
  const minX = Math.min(...shapes.map((s) => s.x - Math.max(s.w, s.h) / 2));
  const maxX = Math.max(...shapes.map((s) => s.x + Math.max(s.w, s.h) / 2));
  const minY = Math.min(...shapes.map((s) => s.y - Math.max(s.w, s.h) / 2));
  const maxY = Math.max(...shapes.map((s) => s.y + Math.max(s.w, s.h) / 2));
  const pad = 10;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const body = shapes.map((s) => {
    const t = `transform="rotate(${s.rot} ${s.x} ${s.y})"`;
    const shape = s.shape === 'circle'
      ? `<ellipse cx="${s.x}" cy="${s.y}" rx="${s.w / 2}" ry="${s.h / 2}" fill="${esc(s.color)}" stroke="#333" stroke-width="1.5" ${t}/>`
      : `<rect x="${s.x - s.w / 2}" y="${s.y - s.h / 2}" width="${s.w}" height="${s.h}" rx="4" fill="${esc(s.color)}" stroke="#333" stroke-width="1.5" ${t}/>`;
    return `${shape}<title>${esc(s.label)}</title>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><rect x="${minX - pad}" y="${minY - pad}" width="${maxX - minX + 2 * pad}" height="${maxY - minY + 2 * pad}" fill="#f6f3ee"/>${body}</svg>`;
}

export function assetSvg(asset: Asset, library: Library): string {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  if (asset.composite) {
    return shapesSvg(asset.composite.members.flatMap((m) => {
      const a = byId.get(m.assetId);
      return a ? [{ x: m.dx, y: m.dy, w: a.w, h: a.h, rot: m.rot, color: m.color ?? a.color, shape: a.shape, label: a.name }] : [];
    }));
  }
  return shapesSvg([{ x: 0, y: 0, w: asset.w, h: asset.h, rot: 0, color: asset.color, shape: asset.shape, label: asset.name }]);
}

/** r2_2 → r29: render thumbnails for the given (new) asset ids. */
export function renderThumbnails(library: Library, assetIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of library.assets) if (assetIds.includes(a.id)) out[a.id] = assetSvg(a, library);
  return out;
}
