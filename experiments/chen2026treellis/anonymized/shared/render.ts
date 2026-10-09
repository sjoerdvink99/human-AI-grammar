// tool translate (part 2): scene tree r4 → rendered SVG picture r5.
import { fmt, type Program, type SceneNode, type Value } from './dsl';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SVG_NAME: Record<string, string> = {
  w: 'width', h: 'height', stroke_width: 'stroke-width', size: 'font-size',
  anchor: 'text-anchor', weight: 'font-weight', points: 'points', d: 'd',
};

function v(x: Value | undefined): string {
  if (x === undefined) return '';
  return typeof x === 'number' ? fmt(x) : x;
}

function renderNode(n: SceneNode): string {
  const a = Object.fromEntries(Object.entries(n.attrs).map(([k, at]) => [k, at.value]));
  const out: string[] = [`data-node-id="${esc(n.id)}"`];
  const rotate = a.rotate !== undefined ? Number(a.rotate) : 0;

  if (n.kind === 'group') {
    const t: string[] = [];
    if (a.x !== undefined || a.y !== undefined) t.push(`translate(${v(a.x ?? 0)} ${v(a.y ?? 0)})`);
    if (a.scale !== undefined) t.push(`scale(${v(a.scale)})`);
    if (t.length) out.push(`transform="${t.join(' ')}"`);
    const style = rotate ? ` style="transform-box:fill-box;transform-origin:center;rotate:${rotate}deg"` : '';
    for (const k of ['fill', 'stroke', 'stroke_width', 'opacity'] as const)
      if (a[k] !== undefined) out.push(`${SVG_NAME[k] ?? k}="${esc(v(a[k]))}"`);
    // rotation is applied on an inner group so it composes after translate/scale
    const inner = n.children.map(renderNode).join('');
    return `<g ${out.join(' ')}>${rotate ? `<g${style}>${inner}</g>` : inner}</g>`;
  }

  for (const [k, val] of Object.entries(a)) {
    if (k === 'rotate' || k === 'text') continue;
    out.push(`${SVG_NAME[k] ?? k}="${esc(v(val))}"`);
  }
  if (rotate) out.push(`style="transform-box:fill-box;transform-origin:center;rotate:${rotate}deg"`);
  if (n.kind === 'text') {
    if (a.fill === undefined) out.push('fill="#222"');
    return `<text ${out.join(' ')}>${esc(v(a.text))}</text>`;
  }
  if ((n.kind === 'line' || n.kind === 'polyline') && a.stroke === undefined) out.push('stroke="#222"');
  if (n.kind === 'polyline' && a.fill === undefined) out.push('fill="none"');
  return `<${n.kind} ${out.join(' ')}/>`;
}

export function renderSvg(p: Program): string {
  const { width, height, background } = p.canvas;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect data-node-id="" x="0" y="0" width="${width}" height="${height}" fill="${esc(background)}"/>` +
    p.nodes.map(renderNode).join('') +
    `</svg>`
  );
}
