// tool_3 — poster postprocessing.
// element_specs_1 + text_elements_1 + image_elements_1 -> [tool_3 compose] -> poster_1
import type { ElementSpec, ImageElement, TextElement } from '../shared/api';
import { POSTER_SIZE } from './sand';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Greedy wrap with a width estimate of 0.55em per character. */
function wrap(text: string, fontSize: number, width: number): string[] {
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Largest font size whose wrapped text fits the box. */
function fit(text: string, w: number, h: number, maxSize: number, lineH: number) {
  for (let fs = maxSize; fs >= 7; fs -= 1) {
    const lines = wrap(text, fs, w);
    if (lines.length * fs * lineH <= h && lines.every((l) => l.length * fs * 0.55 <= w * 1.05)) return { fs, lines };
  }
  return { fs: 7, lines: wrap(text, 7, w) };
}

export function composePoster(specs: ElementSpec[], texts: TextElement[], images: ImageElement[], background = '#f6f1e7'): string {
  const parts: string[] = [];
  const order = (r: string) => ({ decoration: 0, image: 1, body: 2, subtitle: 3, title: 4 } as Record<string, number>)[r] ?? 5;
  for (const s of [...specs].sort((a, b) => order(a.role) - order(b.role))) {
    if (s.role === 'image' || s.role === 'decoration') {
      const img = images.find((i) => i.clusterId === s.clusterId);
      if (!img) continue;
      const href = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(img.svg)))}`;
      parts.push(`<image href="${href}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="xMidYMid meet" opacity="${(0.55 + 0.45 * s.weight).toFixed(2)}"/>`);
    } else {
      const t = texts.find((x) => x.clusterId === s.clusterId);
      if (!t) continue;
      const maxSize = s.role === 'title' ? 120 : s.role === 'subtitle' ? 40 : 20;
      const lineH = s.role === 'body' ? 1.3 : 1.05;
      const { fs, lines } = fit(t.text, s.w, s.h, maxSize, lineH);
      const fw = Math.round((300 + 600 * s.weight) / 100) * 100; // 300..900
      const family = s.role === 'body' ? "Georgia, 'Times New Roman', serif" : "'Helvetica Neue', Arial, sans-serif";
      const tspans = lines.map((l, i) => `<tspan x="${s.x}" dy="${i === 0 ? fs * 0.9 : fs * lineH}">${esc(l)}</tspan>`).join('');
      parts.push(`<text x="${s.x}" y="${s.y}" font-family="${family}" font-size="${fs}" font-weight="${fw}" fill="#1d1d1f"${s.role === 'title' ? ' letter-spacing="-1"' : ''}>${tspans}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_SIZE} ${POSTER_SIZE}" width="${POSTER_SIZE}" height="${POSTER_SIZE}"><rect width="100%" height="100%" fill="${background}"/>${parts.join('')}</svg>`;
}

export async function svgToPng(svg: string, size = 1024): Promise<string> {
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.getContext('2d')!.drawImage(img, 0, 0, size, size);
  return c.toDataURL('image/png');
}
