/** Validation and sanitizing of generated SVG (the "~" handling for visual outputs). */
import { XMLValidator } from 'fast-xml-parser';

export const SVG_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

export function sanitizeSvgFragment(s: string): string {
  return s
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
}

/** Ensure the string is a standalone SVG document of the given size; throws if it is not SVG at all. */
export function normalizeSvg(raw: string, width: number, height: number): string {
  const clean = sanitizeSvgFragment(raw.trim().replace(/^```(?:svg|xml)?\s*|```$/g, ''));
  const start = clean.search(/<svg[\s>]/i);
  const end = clean.toLowerCase().lastIndexOf('</svg>');
  if (start < 0 || end < 0) {
    console.warn('Not an SVG document; got:', raw.slice(0, 200), '…', raw.slice(-120));
    throw new Error('Model did not return an <svg> document');
  }
  const inner = clean.slice(start, end + 6);
  // Force size + namespace on the root element so the image displays predictably.
  const svg = inner.replace(/<svg\b[^>]*>/i, (tag) => {
    const vb = tag.match(/viewBox\s*=\s*["']([^"']*)["']/i)?.[1] ?? `0 0 ${width} ${height}`;
    return `<svg ${SVG_NS} viewBox="${vb}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">`;
  });
  assertWellFormed(svg);
  return svg;
}

/** Inner content of an SVG document (strip the root svg element). */
export function svgInner(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
}

/** Throws when the SVG is not well-formed XML (a browser would show a broken image). */
export function assertWellFormed(svg: string) {
  const v = XMLValidator.validate(svg);
  if (v !== true) throw new Error(`Generated SVG is not well-formed XML: ${v.err.msg} (line ${v.err.line})`);
}
