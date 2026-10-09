// model_3 translate: request_1 → query_embedding_1 (text embedding model).
import { localPipeline } from './transformers';

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;
let usingFallback = false;

/** Deterministic hashed character-trigram embedding, used only if the local model cannot load. */
export function hashedEmbedding(text: string, dim = EMBEDDING_DIM): number[] {
  const v = new Array(dim).fill(0);
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;
  for (let i = 0; i < t.length - 2; i++) {
    let h = 2166136261;
    for (const ch of t.slice(i, i + 3)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[Math.abs(h) % dim] += h & 1 ? 1 : -1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export async function embedRequest(request: string): Promise<{ embedding: number[]; model: string }> {
  try {
    const extractor = await localPipeline('feature-extraction', EMBEDDING_MODEL);
    const out = await extractor(request, { pooling: 'mean', normalize: true });
    return { embedding: Array.from(out.data as Float32Array).map((x) => Math.round(x * 1e5) / 1e5), model: EMBEDDING_MODEL };
  } catch (e) {
    if (!usingFallback) console.warn('[model_3] embedding model unavailable, using hashed fallback:', String(e));
    usingFallback = true;
    return { embedding: hashedEmbedding(request), model: 'hashed-trigram-fallback' };
  }
}
