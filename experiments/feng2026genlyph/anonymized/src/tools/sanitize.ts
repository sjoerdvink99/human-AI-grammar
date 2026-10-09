/**
 * Validation of generative SVG output (the `~` steps model_2 and model_5).
 * String-based so it runs both on the server and in the browser.
 */

export const CANVAS = { width: 400, height: 300 };

export class InvalidSvgError extends Error {}

/** Extract, sanitise and validate one <svg> document from a model reply. */
export function extractSvg(reply: string): string {
  const m = reply.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) throw new InvalidSvgError("model reply contained no <svg> element");
  let svg = m[0];
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(image|use)\b[^>]*\b(?:xlink:)?href\s*=\s*["'](?!#)[^"']*["'][^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "");
  if (!/\bxmlns\s*=/.test(svg.slice(0, svg.indexOf(">")))) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\bviewBox\s*=/.test(svg.slice(0, svg.indexOf(">")))) {
    const w = Number(svg.match(/<svg[^>]*\bwidth\s*=\s*["']?([\d.]+)/i)?.[1] ?? CANVAS.width);
    const h = Number(svg.match(/<svg[^>]*\bheight\s*=\s*["']?([\d.]+)/i)?.[1] ?? CANVAS.height);
    svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  const shapes = (svg.match(/<(path|rect|circle|ellipse|polygon|polyline|line)\b/gi) ?? []).length;
  if (shapes === 0) throw new InvalidSvgError("SVG contains no drawable shapes");
  return svg;
}

export function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } {
  const vb = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  const [x, y, w, h] = (vb ?? `0 0 ${CANVAS.width} ${CANVAS.height}`).split(/[\s,]+/).map(Number);
  return { x, y, w: w || CANVAS.width, h: h || CANVAS.height };
}
