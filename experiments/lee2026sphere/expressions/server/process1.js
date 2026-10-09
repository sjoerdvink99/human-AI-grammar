// Process 1: request -> retrieval -> procedural generation -> scene_1 (+ retrieval_trace_1, interaction_log_1)
import { callModel } from './llm.js';
import { embedRequest } from './embedding.js';
import { cosine } from './catalog.js';
import { SCENE_LIBRARY } from './sceneLibrary.js';
import { sampleScenes, selectAffordances, makeRng } from './policy.js';
import { generateRoomConstraints, composeGenerationConstraints, generateSceneGraph } from './generator.js';
import { sceneFromGraph } from './scene.js';

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Preference-memory match of a scene in [0,1]. */
function preferenceMatch(scene, memory) {
  let s = 0;
  for (const [cat, n] of Object.entries(scene.objects)) s += (memory.object_prefs[cat] || 0) * Math.min(1, n);
  const keys = new Set(scene.affordances.map((a) => a.key));
  for (const c of memory.constraints) if (keys.has(c.key)) s += c.weight;
  return r3(0.5 + 0.5 * Math.tanh(s / 3));
}

/** [tool_3 match] query_embedding_1 + preference_memory_1 + retrieval_policy_1 -> candidate_scenes_1* */
export function matchCandidates(queryEmbedding, memory, policy) {
  const pool = [...SCENE_LIBRARY, ...memory.user_scenes];
  return pool
    .map((s) => {
      const sim = r3(cosine(queryEmbedding, s.vector));
      const pref = preferenceMatch(s, memory);
      const value = policy.scene_values[s.id] ?? 0;
      return { ...s, sim, pref, prescore: r3(policy.w_embed * sim + policy.w_pref * (pref - 0.5) + policy.w_value * value) };
    })
    .sort((a, b) => b.prescore - a.prescore)
    .slice(0, policy.k_candidates);
}

const SCENE_SYSTEM = `You are a scene-retrieval reranker (role: model_4). Given a room request and candidate example scenes,
rate how useful each scene is as a template for the requested room, from 0 (useless) to 1 (ideal).
Consider room type, activities, required objects, style and size. Return JSON only.`;
const SCENE_SCHEMA = {
  type: 'object',
  properties: { scores: { type: 'array', items: { type: 'object', properties: { scene_id: { type: 'string' }, score: { type: 'number' }, reason: { type: 'string' } }, required: ['scene_id', 'score'] } } },
  required: ['scores'],
};

/** [model_4 match] request_1 + query_embedding_1 + candidate_scenes_1* + retrieval_policy_1 -> scored_scenes_1 (table) */
export async function scoreScenes(request, candidates, policy) {
  const out = await callModel({
    role: 'model_4', system: SCENE_SYSTEM, schema: SCENE_SCHEMA,
    prompt: `Request: """${request}"""\n\nCandidate scenes:\n${candidates.map((c) => `- ${c.id}: ${c.description}`).join('\n')}`,
  });
  const scores = new Map((out?.scores || []).map((s) => [s.scene_id, s]));
  return candidates.map((c) => {
    const llm = Math.min(1, Math.max(0, Number(scores.get(c.id)?.score) || 0));
    const value = policy.scene_values[c.id] ?? 0;
    return {
      scene_id: c.id, name: c.name, source: c.source, sim: c.sim, llm_score: r3(llm), pref: c.pref, value: r3(value),
      total: r3(policy.w_embed * c.sim + policy.w_llm * llm + policy.w_pref * (c.pref - 0.5) + policy.w_value * value),
      reason: scores.get(c.id)?.reason || '',
    };
  }).sort((a, b) => b.total - a.total);
}

const AFF_SYSTEM = `You are a spatial-affordance matcher (role: model_5). Given a room request and spatial affordances
taken from example scenes, rate how well each affordance fits what the requester wants, from 0 (conflicts or irrelevant)
to 1 (essential). Return JSON only.`;
const AFF_SCHEMA = {
  type: 'object',
  properties: { scores: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, score: { type: 'number' } }, required: ['index', 'score'] } } },
  required: ['scores'],
};

/** [model_5 match] request_1 + sampled_scenes_1* + retrieval_policy_1 -> scored_affordances_1 (table) */
export async function scoreAffordances(request, sampledScenes, policy) {
  const items = sampledScenes.flatMap((s) => s.affordances.map((a) => ({ ...a, source_scene: s.id })));
  const out = await callModel({
    role: 'model_5', system: AFF_SYSTEM, schema: AFF_SCHEMA,
    prompt: `Request: """${request}"""\n\nAffordances:\n${items.map((a, i) => `${i}. ${a.text} (from ${a.source_scene})`).join('\n')}`,
  });
  const scores = new Map((out?.scores || []).map((s) => [s.index, s.score]));
  return items.map((a, i) => {
    const llm = Math.min(1, Math.max(0, Number(scores.get(i)) || 0));
    const value = policy.affordance_values[a.key] ?? 0;
    return { key: a.key, text: a.text, constraint: a.constraint, source_scene: a.source_scene, llm_score: r3(llm), value: r3(value), total: r3(llm + policy.w_value * value) };
  }).sort((a, b) => b.total - a.total);
}

/**
 * Runs process 1 end to end, reporting each state through emit(step, data).
 */
export async function runProcess1({ sessionId, request, memory, policy }, emit) {
  if (!request || !request.trim()) throw new Error('request_1 is empty');
  const query_embedding = await embedRequest(request);
  emit('model_3 translate', { query_embedding });

  const candidates = matchCandidates(query_embedding, memory, policy);
  emit('tool_3 match', { candidate_scenes: candidates.map(({ id, name, sim, pref, prescore, source }) => ({ id, name, sim, pref, prescore, source })) });

  const scored_scenes = await scoreScenes(request, candidates, policy);
  emit('model_4 match', { scored_scenes });

  const rng = makeRng(`${sessionId}:${request}`);
  const sampled_scenes = sampleScenes(scored_scenes, candidates, policy, rng);
  emit('tool_3 select', { sampled_scenes: sampled_scenes.map(({ id, name, sample_probability }) => ({ id, name, sample_probability: r3(sample_probability) })) });

  const scored_affordances = await scoreAffordances(request, sampled_scenes, policy);
  emit('model_5 match', { scored_affordances });

  const sampled_affordances = selectAffordances(scored_affordances);
  emit('tool_3 select', { sampled_affordances });

  const room_constraints = generateRoomConstraints(request, sampled_scenes, sampled_affordances);
  const retrieval_trace = {
    session_id: sessionId, request, query_embedding,
    candidate_scenes: candidates.map((c) => ({ id: c.id, sim: c.sim, pref: c.pref })),
    scored_scenes,
    sampled_scenes: sampled_scenes.map((s) => ({ id: s.id, name: s.name, sample_probability: r3(s.sample_probability) })),
    scored_affordances, sampled_affordances, room_constraints,
    policy_version: policy.version, memory_version: memory.version,
  };
  emit('tool_1 generate', { room_constraints });

  const generation_constraints = composeGenerationConstraints(room_constraints, sampled_affordances);
  emit('tool_3 compose', { generation_constraints });

  const scene_graph = generateSceneGraph(generation_constraints, `${sessionId}:${request}`);
  emit('tool_1 generate', { scene_graph });

  const scene = sceneFromGraph(scene_graph);
  const interaction_log = { session_id: sessionId, events: [{ t: Date.now(), type: 'generated', request, objects: scene.objects.length }] };
  emit('tool_2 translate', { scene });
  return { scene, retrieval_trace, interaction_log };
}
