// tool_2 = edge detection: cuts the parts out by their masks and derives their edge maps
import type { BBox, Fragment, FragmentEdges, GlyphImage, Mask } from '../types';
import { unionBox } from './svg';

export function setAttr(markup: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  return re.test(markup) ? markup.replace(re, ` ${name}="${value}"`) : markup.replace(/\/>$/, ` ${name}="${value}"/>`);
}

export function pad(b: BBox, p = 4): BBox {
  return [b[0] - p, b[1] - p, b[2] + 2 * p, b[3] + 2 * p];
}

/** [tool_2 extract] glyph_image_1 + masks_2* -> fragments_1* + fragment_edges_1* */
export function extractFragments(gi: GlyphImage, masks: Mask[]): { fragments: Fragment[]; edges: FragmentEdges[] } {
  const fragments: Fragment[] = [];
  const edges: FragmentEdges[] = [];
  for (const m of masks) {
    const shapes = gi.shapes.filter((s) => m.gids.includes(s.gid));
    if (shapes.length === 0) continue;
    const bbox = unionBox(shapes.map((s) => s.bbox));
    const vb = pad(bbox).join(' ');
    fragments.push({
      maskId: m.id,
      name: m.name,
      bbox,
      shapes,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><defs>${gi.defs}</defs>${shapes.map((s) => s.markup).join('')}</svg>`,
    });
    const edgeMarkup = shapes
      .map((s) => setAttr(setAttr(setAttr(setAttr(s.markup, 'fill', 'none'), 'stroke', '#111'), 'stroke-width', '1.5'), 'opacity', '1'))
      .join('');
    edges.push({
      maskId: m.id,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><rect x="${pad(bbox)[0]}" y="${pad(bbox)[1]}" width="100%" height="100%" fill="#fff"/>${edgeMarkup}</svg>`,
      edges: shapes.map((s) => ({ gid: s.gid, tag: s.tag, bbox: s.bbox })),
    });
  }
  return { fragments, edges };
}
