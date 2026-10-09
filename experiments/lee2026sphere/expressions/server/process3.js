// Process 3: learn from a finished session -> preference_memory_2 and retrieval_policy_2.
import { callModel, dataUrlToTempFile } from './llm.js';
import { AXES, CATEGORIES } from './catalog.js';
import { withAffordanceText } from './sceneLibrary.js';
import { extractObjectFeatures, assignZones, extractGeometricContext, affordancesToConstraints } from './analysis.js';
import { computeRewards, trainPolicy } from './policy.js';

/** [tool_4 compose] scene_1 + interaction_log_1 + retrieval_trace_1 -> session_payload_1 */
export function composeSessionPayload(session) {
  return {
    session_id: session.id,
    request: session.retrieval_trace.request,
    scene: session.scene,
    interaction_log: session.interaction_log,
    retrieval_trace: session.retrieval_trace,
  };
}

function editSummary(payload) {
  return payload.interaction_log.events.filter((e) => e.type === 'edit')
    .map((e) => `"${e.transcript}" -> ${e.report.filter((r) => r.ok).map((r) => r.message).join('; ')}`);
}

const EXPAND_SYSTEM = `You are a scene-understanding model (role: model_6). Expand a flat geometric description of a
furnished room into a hierarchy: room -> functional zones -> object groups, explaining the purpose of each level and the
spatial relations that hold each group together. Base it strictly on the given geometry. Return JSON only.`;
const EXPAND_SCHEMA = {
  type: 'object',
  properties: {
    room: { type: 'object', properties: { type: { type: 'string' }, purpose: { type: 'string' } }, required: ['type', 'purpose'] },
    zones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, purpose: { type: 'string' },
          groups: { type: 'array', items: { type: 'object', properties: {
            name: { type: 'string' }, objects: { type: 'array', items: { type: 'string' } }, purpose: { type: 'string' },
            relations: { type: 'array', items: { type: 'string' } },
          }, required: ['name', 'objects', 'purpose', 'relations'] } },
        },
        required: ['id', 'name', 'purpose', 'groups'],
      },
    },
  },
  required: ['room', 'zones'],
};

/** [model_6 expand]~ geometric_context_1 (+ session_payload_1) -> hierarchical_context_1 */
export async function expandHierarchy(geometric, zones, payload) {
  const out = await callModel({
    role: 'model_6', system: EXPAND_SYSTEM, schema: EXPAND_SCHEMA,
    prompt: `Original request: """${payload.request}"""\n\nFunctional zones (deterministic):\n${JSON.stringify(zones)}\n\nGeometric context graph:\n${JSON.stringify(geometric)}`,
  });
  const ids = new Set(payload.scene.objects.map((o) => o.id));
  for (const z of out.zones || []) for (const g of z.groups || []) g.objects = (g.objects || []).filter((id) => ids.has(id));
  return out;
}

const AFF_SYSTEM = `You are a scene-understanding model (role: model_6). From a hierarchical description of a room the
user has just finished arranging, extract the spatial affordances that capture this user's preferences: short sentences,
each naming one or two objects by their exact category name (${CATEGORIES.join(', ')}) and exactly one spatial relation
from: faces, beside, near, around, under, against the wall, in a corner, in the centre, clearance in front, away from.
Prefer relations the user deliberately created through edits. Return 4-12 affordances. Return JSON only.`;
const AFF_SCHEMA = { type: 'object', properties: { affordances: { type: 'array', items: { type: 'string' } } }, required: ['affordances'] };

/** [model_6 extract]~ hierarchical_context_1 (+ session_payload_1) -> affordances_1* */
export async function extractAffordances(hierarchical, payload) {
  const out = await callModel({
    role: 'model_6', system: AFF_SYSTEM, schema: AFF_SCHEMA,
    prompt: `Hierarchical context:\n${JSON.stringify(hierarchical)}\n\nUser edits this session:\n${editSummary(payload).join('\n') || '(none)'}`,
  });
  return (out.affordances || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
}

/** [tool_4 compose] spatial_constraints_1* + object_features (via payload) + preference_memory_1 -> preference_memory_2 */
export function updatePreferenceMemory(memory, constraints, features, payload) {
  const m = structuredClone(memory);
  m.version = (memory.version || 1) + 1;
  m.sessions = (m.sessions || 0) + 1;
  for (const f of features) {
    const delta = f.status === 'added' ? 1 : f.status === 'removed' ? -1 : 0.1 + 0.1 * Math.min(3, f.edits || 0);
    m.object_prefs[f.category] = round((m.object_prefs[f.category] || 0) * 0.9 + delta);
  }
  for (const c of m.constraints) c.weight = round(c.weight * 0.9);
  for (const c of constraints.filter((x) => x.parsed)) {
    const old = m.constraints.find((x) => x.key === c.key);
    const gain = c.observed ? 1 : 0.3;
    if (old) { old.weight = round(old.weight + gain); old.count += 1; old.params = c.params; old.text = c.text; }
    else m.constraints.push({ key: c.key, type: c.type, a: c.a, ...(c.b ? { b: c.b } : {}), params: c.params, text: c.text, weight: gain, count: 1 });
  }
  m.constraints = m.constraints.filter((c) => c.weight > 0.05).sort((a, b) => b.weight - a.weight).slice(0, 60);
  // The finished layout becomes a retrievable scene for future requests.
  const q = payload.retrieval_trace.query_embedding;
  const counts = {};
  for (const o of payload.scene.objects) counts[o.category] = (counts[o.category] || 0) + 1;
  const id = `user-${payload.session_id}`;
  m.user_scenes = m.user_scenes.filter((s) => s.id !== id);
  const tags = AXES.filter((_, i) => q[i] > 0.3);
  m.user_scenes.push({
    id, source: 'memory', name: `Your layout: ${payload.request.slice(0, 50)}`, room: { width: payload.scene.room.width, depth: payload.scene.room.depth },
    tags, vector: q, objects: counts,
    description: `User-made layout for "${payload.request}": ${Object.entries(counts).map(([c, n]) => (n > 1 ? `${n} ${c}s` : c)).join(', ').replace(/_/g, ' ')}. Tags: ${tags.join(', ')}.`,
    affordances: constraints.filter((c) => c.parsed && c.observed).map((c) => withAffordanceText({ type: c.type, a: c.a, b: c.b, params: c.params }, id)),
  });
  m.user_scenes = m.user_scenes.slice(-20);
  return m;
}

const EVAL_SYSTEM = `You are a vision-language judge (role: model_7). You see a top-down floor plan of a furnished room.
Each rectangle is labelled with its object id; a small triangle marks the side the object faces; the grid is 1 m.
For every listed spatial affordance, decide whether the layout realizes it: realized, partial, violated, or absent
(the objects involved are not in the room). Judge from the image. Return JSON only.`;
const EVAL_SCHEMA = {
  type: 'object',
  properties: { signals: { type: 'array', items: { type: 'object', properties: {
    key: { type: 'string' }, signal: { type: 'string', enum: ['realized', 'partial', 'violated', 'absent'] }, note: { type: 'string' },
  }, required: ['key', 'signal'] } } },
  required: ['signals'],
};

/** [model_7 evaluate] topdown_view_1 + retrieval_trace_1 -> realization_signals_1* */
export async function evaluateRealization(topdownDataUrl, trace) {
  const file = dataUrlToTempFile(topdownDataUrl);
  const list = trace.sampled_affordances.map((a) => `- key=${a.key}: ${a.text}`).join('\n');
  const out = await callModel({
    role: 'model_7', system: EVAL_SYSTEM, schema: EVAL_SCHEMA, images: [file],
    prompt: `Affordances retrieved for this room:\n${list}`,
  });
  const keys = new Set(trace.sampled_affordances.map((a) => a.key));
  return (out.signals || []).filter((s) => keys.has(s.key));
}

export async function runProcess3A(session, memory, emit) {
  const session_payload = composeSessionPayload(session);
  emit('tool_4 compose', { session_payload: { session_id: session_payload.session_id, request: session_payload.request, objects: session_payload.scene.objects.length, events: session_payload.interaction_log.events.length } });
  const object_features = extractObjectFeatures(session_payload);
  emit('tool_4 extract', { object_features });
  const functional_zones = assignZones(object_features);
  emit('tool_4 assign', { functional_zones });
  const geometric_context = extractGeometricContext(session_payload, functional_zones);
  emit('tool_4 extract', { geometric_context });
  const hierarchical_context = await expandHierarchy(geometric_context, functional_zones, session_payload);
  emit('model_6 expand', { hierarchical_context });
  const affordances = await extractAffordances(hierarchical_context, session_payload);
  emit('model_6 extract', { affordances });
  const spatial_constraints = affordancesToConstraints(affordances, session_payload, geometric_context);
  emit('tool_4 translate', { spatial_constraints });
  const preference_memory = updatePreferenceMemory(memory, spatial_constraints, object_features, session_payload);
  emit('tool_4 compose', { preference_memory });
  return preference_memory;
}

export async function runProcess3B(session, topdownDataUrl, policy, emit) {
  const trace = session.retrieval_trace;
  const realization_signals = await evaluateRealization(topdownDataUrl, trace);
  emit('model_7 evaluate', { realization_signals });
  const rewards = computeRewards(realization_signals, trace);
  emit('tool_5 evaluate', { rewards });
  const retrieval_policy = trainPolicy(rewards, policy, trace);
  emit('tool_5 train', { retrieval_policy });
  return retrieval_policy;
}

const round = (x) => Math.round(x * 1000) / 1000;
