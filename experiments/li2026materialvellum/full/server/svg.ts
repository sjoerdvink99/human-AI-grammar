// Validation of generative image output (model_1 emits SVG in this implementation).

export function extractSvg(text: string): string {
  const m = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new Error('model_1 returned no <svg> element');
  return sanitizeSvg(m[0]);
}

export function sanitizeSvg(svg: string): string {
  let s = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*(javascript:|https?:)[^"']*/gi, '$1#');
  if (!/xmlns=/.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

/** Make sure an SVG has the expected viewBox so it composes correctly. */
export function ensureViewBox(svg: string, w: number, h: number): string {
  if (/viewBox=/i.test(svg)) return svg;
  return svg.replace(/<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
}

/** Strip a full-canvas background rect (transparency requirement for poster images). */
export function stripBackground(svg: string, w: number, h: number): string {
  const re = new RegExp(
    `<rect[^>]*?width=["'](?:100%|${w})["'][^>]*?height=["'](?:100%|${h})["'][^>]*/?>(?:</rect>)?`,
    'gi',
  );
  let removed = false;
  return svg.replace(re, (m) => {
    if (removed || /fill=["']none["']/i.test(m)) return m;
    // only remove the first one that sits at the origin
    if (/\sx=["'](?!0)/.test(m) || /\sy=["'](?!0)/.test(m)) return m;
    removed = true;
    return '';
  });
}
