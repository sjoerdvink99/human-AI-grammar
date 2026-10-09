// [tool_1 translate] keywords_1* -> word_cloud_1 (spiral placement with rectangle collision)
import type { Keyword, WordCloudItem } from '../types';

const PALETTE = ['#2a6f97', '#c0504d', '#4f8a3c', '#8064a2', '#d4802a', '#3a8f8f', '#a33f7a', '#6b6b2a'];

export function layoutWordCloud(keywords: Keyword[], width = 420, height = 220): WordCloudItem[] {
  const sorted = [...keywords].sort((a, b) => b.weight - a.weight);
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const items: WordCloudItem[] = [];
  sorted.forEach((k, i) => {
    const size = 12 + (k.weight / 10) * 22;
    const w = k.word.length * size * 0.58;
    const h = size;
    for (let t = 0; t < 2000; t += 1) {
      const a = t * 0.35;
      const r = 2 * a;
      const x = width / 2 + r * Math.cos(a) * 1.6 - w / 2;
      const y = height / 2 + r * Math.sin(a) - h / 2;
      if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
      const box = { x0: x - 3, y0: y - 2, x1: x + w + 3, y1: y + h + 2 };
      if (placed.some((p) => !(box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1))) continue;
      placed.push(box);
      items.push({ word: k.word, x: x + w / 2, y: y + h * 0.82, size, color: PALETTE[i % PALETTE.length] });
      break;
    }
  });
  return items;
}
