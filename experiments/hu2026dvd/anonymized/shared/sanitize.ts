import { ELEMENT_KINDS, type ElementKind, type VisualElement } from "./types";

const ALLOWED_TAGS = new Set([
  "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "title",
]);

/**
 * Keep only a safe subset of SVG: drops scripts, foreignObject, external references,
 * event handlers and any tag outside the allow-list. Works on markup strings without a DOM.
 */
export function sanitizeSvg(markup: string): string {
  let s = String(markup ?? "");
  // strip outer <svg> wrapper if the model added one
  s = s.replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  s = s.replace(/<svg\b[^>]*>/gi, "").replace(/<\/svg>/gi, "");
  // remove blocks whose content is dangerous
  s = s.replace(/<(script|style|foreignObject|iframe|image|use|a)\b[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<(script|style|foreignObject|iframe|image|use|a)\b[^>]*\/?>/gi, "");
  // filter tags
  s = s.replace(/<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g, (full, tag: string, attrs: string) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return "";
    const cleaned = attrs
      .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none")
      .replace(/javascript:/gi, "");
    return full.startsWith("</") ? `</${tag}>` : `<${tag}${cleaned}>`;
  });
  return s.trim();
}

export function sanitizeColor(c: unknown, fallback = "#4f6d7a"): string {
  const s = String(c ?? "").trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s)) return s;
  if (/^[a-zA-Z]{3,20}$/.test(s)) return s;
  return fallback;
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};

export const CANVAS = { width: 1000, height: 700 };

/**
 * Validate a model-produced element (r4) and coerce it into the VisualElement type.
 * Enforces: known kind, in-canvas geometry, sanitized SVG, sources only to known documents.
 */
export function validateElement(
  raw: any,
  idx: number,
  docIds: Set<string>,
): VisualElement {
  const kind: ElementKind = (ELEMENT_KINDS as readonly string[]).includes(raw?.kind) ? raw.kind : "shape";
  const w = clamp(raw?.w, 20, CANVAS.width, 200);
  const h = clamp(raw?.h, 20, CANVAS.height, 150);
  return {
    id: String(raw?.id || `el${idx + 1}`).replace(/[^\w-]/g, "").slice(0, 40) || `el${idx + 1}`,
    name: String(raw?.name ?? `Element ${idx + 1}`).slice(0, 80),
    kind,
    description: String(raw?.description ?? "").slice(0, 600),
    text: String(raw?.text ?? "").slice(0, 400),
    x: clamp(raw?.x, 0, CANVAS.width - w, 0),
    y: clamp(raw?.y, 0, CANVAS.height - h, 0),
    w,
    h,
    color: sanitizeColor(raw?.color),
    svg: sanitizeSvg(raw?.svg ?? ""),
    sources: Array.isArray(raw?.sources)
      ? raw.sources
          .filter((s: any) => docIds.has(String(s?.docId)))
          .map((s: any) => ({ docId: String(s.docId), quote: String(s.quote ?? "").slice(0, 500) }))
      : [],
  };
}

/** Make ids unique within the collection. */
export function dedupeIds(elements: VisualElement[]): VisualElement[] {
  const seen = new Set<string>();
  return elements.map((e) => {
    let id = e.id;
    let n = 2;
    while (seen.has(id)) id = `${e.id}_${n++}`;
    seen.add(id);
    return { ...e, id };
  });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
