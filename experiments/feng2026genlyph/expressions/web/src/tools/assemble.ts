import type {
  AssemblySettings, AttributeMapping, Attributes, Contour, Dataset, EncodingVariant, Fragment, Glyph,
} from '../types';
import type { Skeleton } from './fragments';
import { innerOf, viewBoxOf } from './svgutil';

export interface NumericalFragment { rowIndex: number; maskId: string; transform: string; opacity: number; lightness: number }

function norm(v: number, min = 0, max = 1) {
  return max === min ? 1 : Math.max(0, Math.min(1, (v - min) / (max - min)));
}

/** [tool_3 translate] assembly_settings_1 + fragment_contours_1* + mappings + dataset -> numerical_fragments_1* */
export function numericalFragments(
  ds: Dataset, attrs: Attributes, mappings: AttributeMapping[], contours: Contour[], settings: AssemblySettings,
): NumericalFragment[] {
  const out: NumericalFragment[] = [];
  ds.rows.forEach((row, rowIndex) => {
    for (const c of contours) {
      const nums = mappings.filter((m) => m.maskId === c.maskId && m.kind === 'numeric');
      const transforms: string[] = [];
      let opacity = 1, lightness = 1;
      for (const m of nums) {
        const a = attrs.find((x) => x.name === m.attribute);
        const s = settings.numeric[m.attribute];
        if (!a || !s) continue;
        const t = norm(Number(row[m.attribute]), a.min, a.max);
        const val = s.from + t * (s.to - s.from);
        const ax = c.bbox.x + c.bbox.w / 2;
        const ay = s.anchor === 'bottom' ? c.bbox.y + c.bbox.h : s.anchor === 'top' ? c.bbox.y : c.bbox.y + c.bbox.h / 2;
        const around = (inner: string) => `translate(${ax} ${ay}) ${inner} translate(${-ax} ${-ay})`;
        if (s.channel === 'scale') transforms.push(around(`scale(${val})`));
        else if (s.channel === 'stretchY') transforms.push(around(`scale(1 ${val})`));
        else if (s.channel === 'stretchX') transforms.push(around(`scale(${val} 1)`));
        else if (s.channel === 'rotate') transforms.push(`rotate(${val} ${ax} ${ay})`);
        else if (s.channel === 'opacity') opacity *= val;
        else if (s.channel === 'lightness') lightness *= val;
      }
      out.push({ rowIndex, maskId: c.maskId, transform: transforms.join(' '), opacity, lightness });
    }
  });
  return out;
}

/** [tool_3 compose] -> glyphs_1*: one glyph per data row. */
export function composeGlyphs(
  ds: Dataset, skeleton: Skeleton, fragments: Fragment[], variants: EncodingVariant[],
  mappings: AttributeMapping[], numFrags: NumericalFragment[], settings: AssemblySettings,
): Glyph[] {
  return ds.rows.map((row, rowIndex) => {
    const filters: string[] = [];
    const parts = skeleton.order.map((item) => {
      if (item.kind === 'base') return settings.showBase ? item.markup : '';
      const f = fragments.find((x) => x.maskId === item.maskId);
      if (!f) return '';
      let content = f.inner;
      const cat = mappings.find((m) => m.maskId === item.maskId && m.kind === 'categorical');
      if (cat) {
        const v = variants.find((x) => x.maskId === item.maskId && x.value === String(row[cat.attribute]));
        if (v && v.versions.length) {
          const vs = v.versions[v.current];
          const [x, y, w, h] = viewBoxOf(vs);
          const defs = (vs.match(/<defs[\s\S]*?<\/defs>/) || [''])[0];
          content = `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="visible">${defs}${innerOf(vs).replace(/<defs[\s\S]*?<\/defs>/, '')}</svg>`;
        }
      }
      const nf = numFrags.find((n) => n.rowIndex === rowIndex && n.maskId === item.maskId);
      let attrs = '';
      if (nf) {
        if (nf.transform) attrs += ` transform="${nf.transform}"`;
        if (nf.opacity !== 1) attrs += ` opacity="${nf.opacity.toFixed(3)}"`;
        if (nf.lightness !== 1) {
          const fid = `lt-${rowIndex}-${item.maskId}`;
          const k = nf.lightness.toFixed(3);
          filters.push(
            `<filter id="${fid}"><feComponentTransfer><feFuncR type="linear" slope="${k}"/><feFuncG type="linear" slope="${k}"/><feFuncB type="linear" slope="${k}"/></feComponentTransfer></filter>`,
          );
          attrs += ` filter="url(#${fid})"`;
        }
      }
      return `<g data-mask="${item.maskId}"${attrs}>${content}</g>`;
    });
    const defs = skeleton.defs || filters.length ? `<defs>${skeleton.defs}${filters.join('')}</defs>` : '';
    return { rowIndex, viewBox: skeleton.viewBox, svgInner: defs + parts.join('') };
  });
}

export function glyphSvg(g: Glyph, size?: number): string {
  const sz = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.viewBox}" overflow="visible"${sz}>${g.svgInner}</svg>`;
}
