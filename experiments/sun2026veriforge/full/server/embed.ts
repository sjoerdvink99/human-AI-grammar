// model_2 (embedding model) provider: translate text -> numeric vectors.
// No embedding API is available in this environment, so the default is a local
// hashed bag-of-words + character-trigram embedding. Swap `embed` to use a real model.

export const DIM = 512;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const STOP = new Set("the a an of and or to in on for with by at from is are was were be as that this it its into".split(" "));

function stem(w: string): string {
  return w.replace(/(ies)$/, "y").replace(/(es|s)$/, "").replace(/(ing|ed)$/, "");
}

export function embedOne(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9À-ɏ]+/g) ?? [];
  for (const raw of words) {
    if (STOP.has(raw)) continue;
    const w = stem(raw);
    const hw = hash("w:" + w);
    v[hw % DIM] += (hw & 1 ? 1 : -1) * 2;
    const padded = ` ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const hg = hash("g:" + padded.slice(i, i + 3));
      v[hg % DIM] += hg & 1 ? 0.5 : -0.5;
    }
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function embed(texts: string[]): Promise<number[][]> {
  return texts.map(embedOne);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
