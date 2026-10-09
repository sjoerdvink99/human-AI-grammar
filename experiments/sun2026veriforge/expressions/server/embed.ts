// model_2 translate: concepts → vectors. A local sentence-embedding model (Transformers.js, all-MiniLM-L6-v2).
// The Claude CLI cannot return embeddings, so this model role runs locally. If the model cannot be
// downloaded/loaded, a deterministic hashed character-trigram vectorizer is used instead.
type Extractor = (texts: string[], opts: object) => Promise<{ tolist(): number[][] }>;

let extractor: Extractor | null = null;
let loading: Promise<void> | null = null;
export let embedderName = 'loading';

async function load() {
  if (process.env.SYSTEMX_EMBEDDER === 'hash') { embedderName = 'hashed-trigrams'; return; }
  try {
    const { pipeline } = await import('@huggingface/transformers');
    extractor = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' })) as unknown as Extractor;
    embedderName = 'all-MiniLM-L6-v2';
  } catch (e) {
    console.warn('[model_2] embedding model unavailable, falling back to hashed trigrams:', (e as Error).message);
    embedderName = 'hashed-trigrams';
  }
}

export const embedderReady = () => (loading ??= load());

/** Similarity threshold appropriate for the active embedder. */
export const matchThreshold = () => (embedderName === 'all-MiniLM-L6-v2' ? 0.55 : 0.45);

function hashEmbed(text: string, dim = 384): number[] {
  const v = new Array(dim).fill(0);
  const s = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  for (let i = 0; i < s.length - 2; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619);
    v[Math.abs(h) % dim] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

const cache = new Map<string, number[]>();

export async function embed(texts: string[]): Promise<number[][]> {
  await embedderReady();
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    if (extractor) {
      for (let i = 0; i < missing.length; i += 64) {
        const batch = missing.slice(i, i + 64);
        const out = (await extractor(batch, { pooling: 'mean', normalize: true })).tolist();
        batch.forEach((t, k) => cache.set(t, out[k]));
      }
    } else missing.forEach((t) => cache.set(t, hashEmbed(t)));
  }
  return texts.map((t) => cache.get(t)!);
}

export const cosine = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
