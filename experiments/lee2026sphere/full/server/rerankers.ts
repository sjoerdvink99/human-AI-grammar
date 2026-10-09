// model_4 (scene retrieval reranker) and model_5 (affordance retrieval reranker).
// Each is a single-query cross-attention scorer: logits_i = alpha * q^T (I + A B^T) k_i,
// attention = softmax(logits / temperature). A and B are the LoRA matrices trained by tool_5.
import type { LoraReranker } from '../shared/types';
import { hashString, mulberry32 } from '../shared/rng';
import { hashedEmbedding } from './model3_embedding';

export function initReranker(dim: number, rank: number, seed: number): LoraReranker {
  const rnd = mulberry32(seed);
  const A = Array.from({ length: dim }, () => Array.from({ length: rank }, () => (rnd() - 0.5) * 0.02));
  const B = Array.from({ length: dim }, () => new Array(rank).fill(0));
  return { dim, rank, alpha: 10, A, B };
}

function projT(M: number[][], v: number[]): number[] {
  const r = M[0]?.length ?? 0;
  const out = new Array(r).fill(0);
  for (let i = 0; i < v.length; i++) for (let j = 0; j < r; j++) out[j] += M[i][j] * v[i];
  return out;
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export function normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]) {
  return dot(a, b) / ((Math.hypot(...a) || 1) * (Math.hypot(...b) || 1));
}

/** Relevance logits of every key for the query (the "match" operation of model_4 / model_5). */
export function scoreKeys(r: LoraReranker, q: number[], keys: number[][]): number[] {
  const u = projT(r.A, q);
  return keys.map((k) => r.alpha * (dot(q, k) + dot(u, projT(r.B, k))));
}

export function softmax(logits: number[], temperature: number): number[] {
  if (!logits.length) return [];
  const m = Math.max(...logits);
  const e = logits.map((l) => Math.exp((l - m) / temperature));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/**
 * Policy gradient of Σ_t advantage_t · log p(chosen_t | remaining) under Plackett–Luce sampling,
 * with respect to A and B.
 */
export function plackettLuceGradient(
  r: LoraReranker,
  q: number[],
  keys: number[][],
  chosen: number[],
  advantages: number[],
  temperature: number,
): { gA: number[][]; gB: number[][] } {
  const logits = scoreKeys(r, q, keys);
  const gLogit = new Array(keys.length).fill(0);
  let remaining = keys.map((_, i) => i);
  chosen.forEach((c, t) => {
    const p = softmax(remaining.map((i) => logits[i]), temperature);
    remaining.forEach((i, j) => {
      gLogit[i] += (advantages[t] * ((i === c ? 1 : 0) - p[j])) / temperature;
    });
    remaining = remaining.filter((i) => i !== c);
  });
  const u = projT(r.A, q);
  const gA = r.A.map((row) => row.map(() => 0));
  const gB = r.B.map((row) => row.map(() => 0));
  keys.forEach((k, i) => {
    if (!gLogit[i]) return;
    const v = projT(r.B, k);
    const g = gLogit[i] * r.alpha;
    for (let a = 0; a < r.dim; a++) {
      for (let j = 0; j < r.rank; j++) {
        gA[a][j] += g * q[a] * v[j];
        gB[a][j] += g * k[a] * u[j];
      }
    }
  });
  return { gA, gB };
}

/** model_5 key encoder: the affordance statement's token features mixed with its source scene's key. */
export function affordanceKey(statement: string, sceneKey: number[]): number[] {
  const f = hashedEmbedding(statement, sceneKey.length);
  return normalize(sceneKey.map((x, i) => 0.6 * x + 0.4 * f[i])).map((x) => Math.round(x * 1e5) / 1e5);
}

/** model_5 query: the request embedding conditioned on the sampled scenes. */
export function affordanceQuery(queryEmbedding: number[], sampledSceneKeys: number[][]): number[] {
  if (!sampledSceneKeys.length) return queryEmbedding;
  const mean = queryEmbedding.map((_, i) => sampledSceneKeys.reduce((s, k) => s + k[i], 0) / sampledSceneKeys.length);
  return normalize(queryEmbedding.map((x, i) => x + 0.5 * mean[i]));
}

export const seedFor = (name: string) => hashString(name);
