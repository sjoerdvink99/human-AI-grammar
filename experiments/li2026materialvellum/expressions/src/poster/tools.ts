/** Deterministic tools of process 3 (all tool_3: converter / compositor). */
import { bbox, clamp, hash01, simplify, smooth } from '../geom';
import { ELEMENT_ROLES, TEXT_ROLES, type BBox, type ElementRoleValue, type Point } from '../shared/api';
import type { ElementRole, ElementSpec, ImageElement, PosterCanvas, SandCluster, SpokenRole, TextElement } from './types';
import { svgDataUrl } from '../api';

export const POSTER: PosterCanvas = { width: 420, height: 594 };

/** Turn a freehand lasso into a clean closed outline (used when a cluster is poured). */
export function closeOutline(pts: Point[]): Point[] {
  const s = smooth(simplify(pts, 3), 2);
  return s.map((p) => ({ x: clamp(Math.round(p.x), 0, POSTER.width), y: clamp(Math.round(p.y), 0, POSTER.height) }));
}

const KEYWORDS: [ElementRoleValue, RegExp][] = [
  ['subtitle', /\b(sub-?title|subheading|tag ?line|slogan|strap ?line)\b/i],
  ['title', /\b(title|headline|heading|header|name of the event)\b/i],
  ['date', /\b(date|time|when|schedule|day)\b/i],
  ['caption', /\b(caption|label|credit|footer|footnote|address|location|venue)\b/i],
  ['body', /\b(body|text|paragraph|description|details|information|info|copy)\b/i],
  ['image', /\b(image|picture|photo|photograph|illustration|drawing|graphic|logo|icon|visual|art)\b/i],
];

/** [tool_3 translate] spoken_roles_1 -> element_roles_1 (keyword classification of the transcript). */
export function tool3SpeechToRoles(spoken: SpokenRole[]): ElementRole[] {
  return spoken.map((s) => {
    const t = s.transcript.trim();
    const exact = ELEMENT_ROLES.find((r) => t.toLowerCase() === r);
    const hit = exact ?? KEYWORDS.find(([, re]) => re.test(t))?.[0];
    return { clusterId: s.clusterId, role: hit ?? 'unknown' };
  });
}

const CHAR_AREA: Record<ElementRoleValue, number> = { title: 700, subtitle: 320, body: 140, date: 260, caption: 180, image: 1 };
const CHAR_LIMIT: Record<ElementRoleValue, [number, number]> = {
  title: [6, 50], subtitle: [12, 90], body: [30, 420], date: [8, 40], caption: [8, 80], image: [0, 0],
};

/** [tool_3 compose] poster_theme_1 + sand_clusters_2 + element_roles_1 -> element_specs_1 */
export function tool3ComposeSpecs(theme: string, clusters: SandCluster[], roles: ElementRole[]): ElementSpec[] {
  const items = clusters
    .map((c) => ({ c, role: roles.find((r) => r.clusterId === c.id)?.role }))
    .filter((x): x is { c: SandCluster; role: ElementRoleValue } => !!x.role && x.role !== 'unknown')
    .map(({ c, role }) => ({ id: c.id, role, bbox: bbox(c.points) }));
  // reading order: top to bottom, then left to right (rows of ~40px)
  items.sort((a, b) => Math.round(a.bbox.y / 40) - Math.round(b.bbox.y / 40) || a.bbox.x - b.bbox.x);
  return items.map((it, i) => {
    const spec: ElementSpec = { id: it.id, role: it.role, bbox: it.bbox, order: i + 1, theme };
    if (TEXT_ROLES.includes(it.role)) {
      const [lo, hi] = CHAR_LIMIT[it.role];
      spec.maxChars = Math.round(clamp((it.bbox.w * it.bbox.h) / CHAR_AREA[it.role], lo, hi));
    }
    return spec;
  });
}

const PALETTES = [
  { bg: '#f4efe6', ink: '#1d1d1f', accent: '#d2462f' },
  { bg: '#10213a', ink: '#f5f1e8', accent: '#f2b134' },
  { bg: '#e9f0ea', ink: '#183a2b', accent: '#2f8f5b' },
  { bg: '#fbe9e1', ink: '#3a1d2e', accent: '#c23b6a' },
  { bg: '#1b1b1b', ink: '#f0f0f0', accent: '#4fc3c8' },
];

export function paletteFor(theme: string) {
  const n = [...theme].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return PALETTES[Math.floor(hash01(n) * PALETTES.length)];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Largest font size at which `text` wraps into the box. */
export function fitText(text: string, box: BBox, maxSize: number, lineHeight = 1.2, charW = 0.56): { size: number; lines: string[] } {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = maxSize; size >= 7; size -= 1) {
    const perLine = Math.max(1, Math.floor(box.w / (size * charW)));
    const lines: string[] = [];
    let cur = '';
    let ok = true;
    for (const w of words) {
      if (w.length > perLine) { ok = false; break; }
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > perLine) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    if (ok && lines.length * size * lineHeight <= box.h) return { size, lines };
  }
  return { size: 7, lines: [text] };
}

const MAX_FONT: Record<ElementRoleValue, number> = { title: 72, subtitle: 30, body: 18, date: 26, caption: 16, image: 0 };

/** [tool_3 compose] element_specs_1 + text_elements_1 + image_elements_1 -> poster_1 (SVG) */
export function tool3ComposePoster(
  specs: ElementSpec[], texts: TextElement[], images: ImageElement[], clusters: SandCluster[], canvas = POSTER,
): string {
  const theme = specs[0]?.theme ?? '';
  const pal = paletteFor(theme);
  const parts: string[] = [];
  const defs: string[] = [];
  for (const s of specs) {
    const b = s.bbox;
    if (s.role === 'image') {
      const img = images.find((i) => i.id === s.id);
      if (!img) continue;
      const poly = clusters.find((c) => c.id === s.id)?.points;
      if (poly) defs.push(`<clipPath id="clip-${s.id}"><polygon points="${poly.map((p) => `${p.x},${p.y}`).join(' ')}"/></clipPath>`);
      parts.push(`<image href="${svgDataUrl(img.svg)}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid slice"${poly ? ` clip-path="url(#clip-${s.id})"` : ''}/>`);
    } else {
      const t = texts.find((x) => x.id === s.id);
      if (!t) continue;
      const isTitle = s.role === 'title';
      const { size, lines } = fitText(isTitle ? t.text.toUpperCase() : t.text, b, MAX_FONT[s.role], isTitle ? 1.05 : 1.25, isTitle ? 0.62 : 0.53);
      const lh = size * (isTitle ? 1.05 : 1.25);
      const fill = s.role === 'subtitle' || s.role === 'date' ? pal.accent : pal.ink;
      const family = isTitle || s.role === 'subtitle' ? "'Georgia', 'Times New Roman', serif" : "'Helvetica Neue', Arial, sans-serif";
      const weight = isTitle ? 800 : s.role === 'date' ? 700 : 400;
      const top = b.y + (b.h - lines.length * lh) / 2 + size * 0.85;
      parts.push(
        `<text font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}">` +
          lines.map((l, i) => `<tspan x="${b.x}" y="${(top + i * lh).toFixed(1)}">${esc(l)}</tspan>`).join('') +
          `</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">` +
    `<defs>${defs.join('')}</defs><rect width="100%" height="100%" fill="${pal.bg}"/>` +
    `<rect x="12" y="12" width="${canvas.width - 24}" height="${canvas.height - 24}" fill="none" stroke="${pal.accent}" stroke-width="1.5"/>` +
    parts.join('') + `</svg>`;
}
