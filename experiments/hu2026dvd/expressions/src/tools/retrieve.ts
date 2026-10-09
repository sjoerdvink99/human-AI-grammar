/** tool_3 select: scene_focus_1 -> guideline_focus_1 + reference_focus_1* (TF-IDF cosine retrieval). */
import type { Guideline, ReferenceVideo, Scene } from '../../shared/types';

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with your you our we than then into over'.split(' '));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9% ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|es|s)$/, ''));
}

export function sceneText(s: Scene): string {
  const kindWords: Record<string, string> = {
    headline: 'headline title question opening',
    big_number: 'big number hook percentage',
    bar: 'bar chart ranking several bars',
    comparison: 'comparison side by side contrast before after',
    quote: 'quote takeaway ending summary',
  };
  return [s.title, s.narration, s.onScreenText, s.visual.label, kindWords[s.visual.kind], s.visual.items.map((i) => i.label).join(' ')].join(' ');
}

function vectors(docs: string[][]) {
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const N = docs.length;
  return docs.map((d) => {
    const v = new Map<string, number>();
    d.forEach((w) => v.set(w, (v.get(w) ?? 0) + 1));
    for (const [w, tf] of v) v.set(w, tf * Math.log(1 + N / (df.get(w) ?? 1)));
    return v;
  });
}

const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0, na = 0, nb = 0;
  for (const [w, x] of a) { na += x * x; dot += x * (b.get(w) ?? 0); }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

export interface Focus {
  sceneId: string;
  guideline: { item: Guideline; score: number } | null;
  references: { item: ReferenceVideo; score: number }[];
}

export function retrieveFocus(scene: Scene, guidelines: Guideline[], references: ReferenceVideo[], k = 3): Focus {
  const q = tokenize(sceneText(scene));
  const gDocs = guidelines.map((g) => tokenize(`${g.title} ${g.text}`));
  const rDocs = references.map((r) => tokenize(`${r.title} ${r.description} ${r.tags.join(' ')}`));
  const all = vectors([q, ...gDocs, ...rDocs]);
  const qv = all[0];
  const gs = guidelines.map((item, i) => ({ item, score: cosine(qv, all[1 + i]) })).sort((a, b) => b.score - a.score);
  const rs = references.map((item, i) => ({ item, score: cosine(qv, all[1 + gDocs.length + i]) })).sort((a, b) => b.score - a.score);
  return { sceneId: scene.id, guideline: gs[0] ?? null, references: rs.slice(0, k) };
}
