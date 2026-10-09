// tool_3: preference retrieval and sampling pipeline (match, select, compose).
import type {
  GenerationConstraints, MemoryAffordance, MemoryScene, PreferenceMemory, RetrievalPolicy,
  RoomConstraints, ScoredAffordanceRow, ScoredSceneRow, SpatialConstraint,
} from '../shared/types';
import { DEFAULT_CONSTRAINTS } from '../shared/catalog';
import { cosine, softmax } from './rerankers';

export interface CandidateScene { scene: MemoryScene; cosine: number }

/** tool_3 match: nearest memory scenes to the query embedding (first-stage retrieval). */
export function matchCandidateScenes(memory: PreferenceMemory, q: number[], policy: RetrievalPolicy): CandidateScene[] {
  return memory.scenes
    .map((scene) => ({ scene, cosine: cosine(q, scene.key) }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, policy.nCandidates);
}

/** Plackett–Luce sampling of k items without replacement from softmax(logits / temperature). */
export function plackettLuceSample(logits: number[], k: number, temperature: number, rnd: () => number): number[] {
  let remaining = logits.map((_, i) => i);
  const chosen: number[] = [];
  while (chosen.length < k && remaining.length) {
    const p = softmax(remaining.map((i) => logits[i]), temperature);
    let u = rnd();
    let j = 0;
    while (j < p.length - 1 && u > p[j]) { u -= p[j]; j++; }
    chosen.push(remaining[j]);
    remaining = remaining.filter((_, idx) => idx !== j);
  }
  return chosen;
}

/** tool_3 select (scenes): sample the scenes that will guide generation. */
export function sampleScenes(
  candidates: CandidateScene[], scored: ScoredSceneRow[], policy: RetrievalPolicy, rnd: () => number,
): MemoryScene[] {
  const idx = plackettLuceSample(scored.map((r) => r.score), policy.kScenes, policy.temperature, rnd);
  return idx.map((i) => candidates[i].scene);
}

/** Affordances eligible for model_5: those stored with the sampled scenes. */
export function affordancePool(sampled: MemoryScene[]): MemoryAffordance[] {
  return sampled.flatMap((s) => s.affordances);
}

/** tool_3 select (affordances): sample the spatial preferences that will guide generation. */
export function sampleAffordances(
  pool: MemoryAffordance[], scored: ScoredAffordanceRow[], policy: RetrievalPolicy, rnd: () => number,
): MemoryAffordance[] {
  const idx = plackettLuceSample(scored.map((r) => r.score), policy.kAffordances, policy.temperature, rnd);
  return idx.map((i) => pool[i]);
}

export function toSceneRows(c: CandidateScene[], logits: number[], temperature: number): ScoredSceneRow[] {
  const p = softmax(logits, temperature);
  return c.map((x, i) => ({ sceneId: x.scene.id, request: x.scene.request, cosine: round(x.cosine), score: round(logits[i]), prob: round(p[i]) }));
}

export function toAffordanceRows(pool: MemoryAffordance[], logits: number[], temperature: number): ScoredAffordanceRow[] {
  const p = softmax(logits, temperature);
  return pool.map((a, i) => ({ affordanceId: a.id, sceneId: a.sceneId, statement: a.statement, score: round(logits[i]), prob: round(p[i]) }));
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** tool_3 compose: room constraints + retrieved spatial preferences → generation constraints. */
export function composeGenerationConstraints(
  room: RoomConstraints, sampledAffordances: MemoryAffordance[], seed: number,
): GenerationConstraints {
  const retrieved: SpatialConstraint[] = [];
  for (const a of sampledAffordances) {
    const dup = retrieved.some((c) => c.kind === a.constraint.kind && c.subject === a.constraint.subject && c.object === a.constraint.object);
    if (!dup) retrieved.push({ ...a.constraint, source: 'retrieved', statement: a.statement, weight: 3 });
  }
  const objectTypes = [...room.objectTypes];
  // a retrieved pairwise preference brings in its subject when its anchor is in the room
  // (e.g. "plant near the armchair" adds a plant to a room that has an armchair); it never adds the anchor
  for (const c of retrieved) {
    if (c.object && objectTypes.includes(c.object) && !objectTypes.includes(c.subject)) objectTypes.push(c.subject);
  }
  const needed = new Set(objectTypes);
  const defaults = DEFAULT_CONSTRAINTS.filter((c) => needed.has(c.subject));
  return { room: room.room, objectTypes, constraints: [...retrieved, ...defaults], seed };
}
