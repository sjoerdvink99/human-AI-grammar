// tool_2 translate: canvas → preview (a stacked shadow-box rendering). Pure, deterministic.
import type { Canvas, CanvasLayer, Segment } from '../shared/types.ts';

export function sortedLayers(c: Canvas): CanvasLayer[] {
  return [...c.layers].sort((a, b) => a.depth - b.depth);
}

export function layerSvg(c: Canvas, layer: CanvasLayer, opts: { outline?: boolean } = {}): string {
  const segs = c.segments.filter((s) => s.layerId === layer.id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.width} ${c.height}">${segs.map((s) => pathTag(s, opts.outline)).join('')}</svg>`;
}

const pathTag = (s: Segment, outline?: boolean) =>
  `<path d="${s.path}" transform="translate(${s.dx} ${s.dy})" fill="${s.color}" fill-rule="evenodd"${outline ? ' stroke="#0003" stroke-width="1"' : ''}/>`;

/** Flat shadow-box preview: every layer casts a soft shadow onto the layers behind. */
export function renderPreview(c: Canvas): string {
  const layers = sortedLayers(c).filter((l) => l.visible);
  const body = layers
    .map((l, i) => {
      const segs = c.segments.filter((s) => s.layerId === l.id);
      const sh = i === 0 ? '' : ' filter="url(#shadow)"';
      return `<g${sh}>${segs.map((s) => pathTag(s)).join('')}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.width} ${c.height}"><defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="3" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.45"/></filter></defs><rect width="${c.width}" height="${c.height}" fill="#f3efe7"/>${body}</svg>`;
}
