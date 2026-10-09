// Process 1: r1 + r2 + r3 → … → r14 + r11 + r15 (compose a scene from a request).
import { AXES, type Candidate, type ChosenAsset, type Library, type Reliability, type RequestEmbedding, type RerankRow, type Shortlisted, type SlotRow } from '../shared/types.ts';
import { callModelJson } from './llm.ts';
import { reliabilityOf } from './library.ts';
import { composeLayoutSpec, generatePlacementRequest, generateSceneGraph, graphToLayout } from './sceneEngine.ts';
import { asArray, asNumber, asObject, asString, type Emit } from './util.ts';

const TOP_K = 18;
const SHORTLIST_MIN_RELEVANCE = 5;

// ---------------------------------------------------------------- model_3 translate: r1 → r4
export async function embedRequest(request: string): Promise<RequestEmbedding> {
  return callModelJson({
    role: 'model_3',
    system: 'You map a natural-language scene request onto fixed semantic axes. Output only JSON.',
    prompt: `Scene request:\n"""${request}"""\n\nRate how strongly the request involves each axis, from 0 (not at all) to 1 (central). Axes, in order:\n${AXES.map((a, i) => `${i}. ${a}`).join('\n')}\n\nReturn {"vector": [${AXES.length} numbers in the order above]}.`,
  }, (v) => {
    const vec = asArray(asObject(v).vector).map((x) => Math.min(1, Math.max(0, asNumber(x))));
    if (vec.length !== AXES.length) throw new Error(`vector must have ${AXES.length} numbers`);
    if (vec.every((x) => x === 0)) throw new Error('vector is all zeros');
    return vec;
  });
}

// ---------------------------------------------------------------- tool_3 match: r4 + r2 → r5*
export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
export function retrieve(embedding: RequestEmbedding, library: Library, k = TOP_K): Candidate[] {
  const scored = library.assets
    .map((a) => ({ asset: a, assetId: a.id, similarity: Math.round(cosine(embedding, a.vector) * 1000) / 1000 }))
    .filter((c) => c.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity);
  // Overall top-k, plus the best 2 assets on every strongly requested axis, so that
  // single-purpose assets (e.g. a plant) are not crowded out by multi-purpose ones.
  const keep = new Set(scored.slice(0, k).map((c) => c.assetId));
  embedding.forEach((w, i) => {
    if (w < 0.4) return;
    scored.filter((c) => c.asset.vector[i] > 0).sort((a, b) => b.asset.vector[i] - a.asset.vector[i] || b.similarity - a.similarity)
      .slice(0, 2).forEach((c) => keep.add(c.assetId));
  });
  return scored.filter((c) => keep.has(c.assetId)).map(({ asset, assetId, similarity }) =>
    (asset.composite ? { assetId, similarity, members: asset.composite.members.map((m) => m.assetId) } : { assetId, similarity }));
}

// ---------------------------------------------------------------- model_4 match: r1 + r4 + r5* → r6
export async function rerank(request: string, embedding: RequestEmbedding, candidates: Candidate[], library: Library): Promise<RerankRow[]> {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const ids = new Set(candidates.map((c) => c.assetId));
  const list = candidates.map((c) => { const a = byId.get(c.assetId)!; return { assetId: a.id, name: a.name, description: a.description, similarity: c.similarity }; });
  const profile = AXES.map((a, i) => `${a}=${embedding[i].toFixed(2)}`).join(', ');
  return callModelJson({
    role: 'model_4',
    system: 'You judge how well furniture/asset candidates match a scene request. Output only JSON.',
    prompt: `Scene request:\n"""${request}"""\nRequest profile: ${profile}\n\nCandidates (retrieved by embedding similarity):\n${JSON.stringify(list, null, 1)}\n\nFor EVERY candidate give relevance 0–10 (10 = clearly requested or essential, 0 = irrelevant) and a short reason.\nReturn {"rows": [{"assetId": string, "relevance": number, "reason": string}]}.`,
  }, (v) => {
    const rows = asArray(asObject(v).rows).map((r) => {
      const o = asObject(r);
      return { assetId: asString(o.assetId), relevance: Math.min(10, Math.max(0, asNumber(o.relevance))), reason: String(o.reason ?? '') };
    }).filter((r) => ids.has(r.assetId));
    if (!rows.length) throw new Error('no rows for known candidates');
    return rows.sort((a, b) => b.relevance - a.relevance);
  });
}

// ---------------------------------------------------------------- tool_3 select: r6 → r7*
export function shortlist(rows: RerankRow[], candidates: Candidate[]): Shortlisted[] {
  const byId = new Map(candidates.map((c) => [c.assetId, c]));
  let keep = rows.filter((r) => r.relevance >= SHORTLIST_MIN_RELEVANCE);
  if (!keep.length) keep = rows.slice(0, 5);
  return keep.map((r) => {
    const c = byId.get(r.assetId);
    return { assetId: r.assetId, relevance: r.relevance, similarity: c?.similarity ?? 0, ...(c?.members ? { members: c.members } : {}) };
  });
}

// ---------------------------------------------------------------- model_5 match: r1 + r7* + r3 → r8
export async function assignSlots(request: string, shortlisted: Shortlisted[], reliability: Reliability, library: Library): Promise<SlotRow[]> {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const ids = new Set(shortlisted.map((s) => s.assetId));
  const list = shortlisted.map((s) => {
    const a = byId.get(s.assetId)!;
    return { assetId: a.id, name: a.name, description: a.description, footprintCm: `${a.w}x${a.h}`, composite: a.composite ? a.composite.members.map((m) => m.assetId) : undefined, relevance: s.relevance, reliability: Number(reliabilityOf(reliability, a.id).toFixed(2)) };
  });
  return callModelJson({
    role: 'model_5',
    system: 'You plan which assets fill which roles ("slots") in a scene. Output only JSON.',
    prompt: `Scene request:\n"""${request}"""\n\nShortlisted assets (reliability = learned quality from past scenes, 0–1; prefer reliable assets when two fit the same slot equally):\n${JSON.stringify(list, null, 1)}\n\nDecompose the request into the functional slots the scene needs (e.g. "main seating", "reading light"). For each slot, list every asset that could fill it with a confidence 0–1 and how many instances (count 1–8) are needed. A composite asset already contains its members; do not also add its members separately for the same slot.\nReturn {"rows": [{"slot": string, "assetId": string, "count": number, "confidence": number}]}.`,
  }, (v) => {
    const rows = asArray(asObject(v).rows).map((r) => {
      const o = asObject(r);
      return { slot: asString(o.slot), assetId: asString(o.assetId), count: Math.round(Math.min(8, Math.max(1, asNumber(o.count)))), confidence: Math.min(1, Math.max(0, asNumber(o.confidence))) };
    }).filter((r) => ids.has(r.assetId));
    if (!rows.length) throw new Error('no slot rows for shortlisted assets');
    return rows;
  });
}

// ---------------------------------------------------------------- tool_3 select: r8 → r9*
export function chooseAssets(rows: SlotRow[], reliability: Reliability, shortlisted: Shortlisted[] = []): ChosenAsset[] {
  const bySlot = new Map<string, ChosenAsset>();
  for (const r of rows) {
    const score = r.confidence * (0.5 + 0.5 * reliabilityOf(reliability, r.assetId));
    const cur = bySlot.get(r.slot);
    if (!cur || score > cur.score) bySlot.set(r.slot, { slot: r.slot, assetId: r.assetId, count: r.count, score: Math.round(score * 1000) / 1000 });
  }
  // the same asset chosen for two slots is placed once (with the larger count)
  const byAsset = new Map<string, ChosenAsset>();
  for (const c of bySlot.values()) { const cur = byAsset.get(c.assetId); if (!cur || c.count > cur.count) byAsset.set(c.assetId, c); }
  // A chosen composite already contains its members: drop separately chosen copies of them.
  const covered = new Map<string, number>();
  for (const c of byAsset.values()) for (const m of shortlisted.find((s) => s.assetId === c.assetId)?.members ?? []) covered.set(m, (covered.get(m) ?? 0) + c.count);
  const out: ChosenAsset[] = [];
  for (const c of byAsset.values()) {
    const left = c.count - (covered.get(c.assetId) ?? 0);
    if (left > 0) out.push({ ...c, count: left });
  }
  return out;
}

// ---------------------------------------------------------------- whole process
export async function runProcess1(request: string, library: Library, reliability: Reliability, emit: Emit) {
  const r4 = await emit.step('r4', 'model_3 translate', () => embedRequest(request));
  const r5 = await emit.step('r5', 'tool_3 match', async () => retrieve(r4, library));
  const r6 = await emit.step('r6', 'model_4 match', () => rerank(request, r4, r5, library));
  const r7 = await emit.step('r7', 'tool_3 select', async () => shortlist(r6, r5));
  const r8 = await emit.step('r8', 'model_5 match', () => assignSlots(request, r7, reliability, library));
  const r9 = await emit.step('r9', 'tool_3 select', async () => chooseAssets(r8, reliability, r7));
  const { placementRequest: r10, scene: r11 } = await emit.step('r10+r11', 'tool_1 generate', async () => generatePlacementRequest(r9, library, request));
  const r12 = await emit.step('r12', 'tool_3 compose', async () => composeLayoutSpec(request, r10, r9, r11));
  const r13 = await emit.step('r13', 'tool_1 generate', async () => generateSceneGraph(r12));
  const { layout: r14, view: r15 } = await emit.step('r14+r15', 'tool_2 translate', async () => graphToLayout(r13, library));
  return { scene: r11, layout: r14, view: r15 };
}
