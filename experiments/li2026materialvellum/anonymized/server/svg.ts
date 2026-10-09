// Validation and sanitisation of generative visual output (SVG).

export class InvalidOutput extends Error {}

/** Extract the SVG document from model text, sanitise it, and check basic structure. */
export function validateSvg(text: string): string {
  const start = text.search(/<svg\b/i);
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) throw new InvalidOutput("no <svg> document in model output");
  let svg = text.slice(start, end + 6);
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(xlink:href|href)\s*=\s*"(?!#|data:image\/)[^"]*"/gi, "");
  const open = svg.match(/<svg\b[^>]*>/i)![0];
  if (!/xmlns\s*=/.test(open)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox\s*=/.test(open)) throw new InvalidOutput("svg has no viewBox");
  if (svg.length > 400_000) throw new InvalidOutput("svg too large");
  const shapes = (svg.match(/<(path|rect|circle|ellipse|polygon|polyline|line|g)\b/gi) ?? []).length;
  if (shapes < 2) throw new InvalidOutput("svg has almost no content");
  return svg;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new InvalidOutput("no JSON object in model output");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new InvalidOutput("model output is not valid JSON");
  }
}

/** Keep the original image outside the selections; take the edited image only inside them. */
export function confineEditToRegions(original: string, edited: string, polygons: { x: number; y: number }[][]): string {
  const inner = (svg: string) => {
    const open = svg.match(/<svg\b[^>]*>/i)![0];
    return svg.slice(svg.indexOf(open) + open.length, svg.toLowerCase().lastIndexOf("</svg>"));
  };
  const prefix = (s: string, p: string) => s
    .replace(/\bid\s*=\s*"([^"]+)"/g, (_m, id) => `id="${p}${id}"`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, id) => `url(#${p}${id})`)
    .replace(/(xlink:href|href)\s*=\s*"#([^"]+)"/g, (_m, a, id) => `${a}="#${p}${id}"`);
  const open = original.match(/<svg\b[^>]*>/i)![0];
  const vbOrig = open.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1];
  const vbEdit = edited.match(/<svg\b[^>]*viewBox\s*=\s*"([^"]+)"/i)?.[1] ?? vbOrig;
  const [, , w, h] = (vbOrig ?? "0 0 800 600").split(/[\s,]+/).map(Number);
  const shapes = polygons.map((p) => `<polygon points="${p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")}" fill="#fff"/>`).join("");
  // Feathered mask: the edit blends into the original over a few pixels at the region border.
  return `${open}<defs><filter id="edit-feather" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4"/></filter>` +
    `<mask id="edit-regions" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><g filter="url(#edit-feather)">${shapes}</g></mask></defs>` +
    `<g>${prefix(inner(original), "o_")}</g>` +
    `<g mask="url(#edit-regions)"><svg x="0" y="0" width="${w}" height="${h}" viewBox="${vbEdit}" preserveAspectRatio="none">${prefix(inner(edited), "e_")}</svg></g></svg>`;
}
