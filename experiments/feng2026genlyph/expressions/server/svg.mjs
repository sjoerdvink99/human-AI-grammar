// Validation of generative SVG outputs (the `~` steps that produce visuals).
const SHAPES = ['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'];

export function extractSvg(text) {
  const m = String(text).match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) throw new Error('Model output did not contain an <svg> element');
  return m[0];
}

export function sanitizeSvg(svg, { viewBox } = {}) {
  let s = svg;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/<(image|text|tspan|a|use)\b[\s\S]*?(\/>|<\/\1>)/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  s = s.replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
  s = s.replace(/@import[^;]*;/gi, '');
  // normalise the root element
  s = s.replace(/<svg\b([^>]*)>/i, (_all, attrs) => {
    let a = attrs;
    let vb = viewBox || (a.match(/viewBox\s*=\s*"([^"]+)"/i) || [])[1];
    if (!vb) {
      const w = parseFloat((a.match(/\swidth\s*=\s*"([\d.]+)/i) || [])[1] || '256');
      const h = parseFloat((a.match(/\sheight\s*=\s*"([\d.]+)/i) || [])[1] || '256');
      vb = `0 0 ${w} ${h}`;
    }
    a = a.replace(/\s(width|height|viewBox|xmlns)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${a}>`;
  });
  return s;
}

/** Tag every drawable shape outside <defs>/<clipPath>/<mask> with a stable data-eid. */
export function tagElements(svg) {
  let i = 0;
  let depthHidden = 0;
  return svg.replace(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g, (all, close, name, attrs, selfClose) => {
    const lower = name.toLowerCase();
    if (['defs', 'clippath', 'mask', 'pattern', 'symbol', 'lineargradient', 'radialgradient', 'filter'].includes(lower)) {
      if (close) depthHidden--; else if (!selfClose) depthHidden++;
      return all;
    }
    if (close || depthHidden > 0 || !SHAPES.includes(lower)) return all;
    const clean = attrs.replace(/\sdata-eid\s*=\s*"[^"]*"/g, '');
    return `<${name} data-eid="e${i++}"${clean}${selfClose}>`;
  });
}

export function countShapes(svg) {
  return (svg.match(/data-eid="/g) || []).length;
}

export function parseJsonLoose(text) {
  const t = String(text);
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('Model output did not contain JSON');
  return JSON.parse(body.slice(start, end + 1));
}
