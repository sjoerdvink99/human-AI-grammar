// [model_3 translate] request_1 -> query_embedding_1
// Claude has no embedding endpoint, so model_3 maps the request onto a fixed set of semantic axes
// (the same axes that index the scene library). The vector is validated and L2-normalised here.
import { callModel } from './llm.js';
import { AXES } from './catalog.js';

const SYSTEM = `You are an embedding model for interior-design requests (role: model_3).
You map a room request onto fixed semantic axes. For every axis output a weight in [0,1]:
1 = the request clearly implies it, 0 = irrelevant. Infer implied axes (e.g. "watch movies" -> watch_tv, relax).
Return only the JSON object.`;

const SCHEMA = {
  type: 'object',
  properties: { weights: { type: 'object', properties: Object.fromEntries(AXES.map((a) => [a, { type: 'number' }])), required: AXES } },
  required: ['weights'],
};

export async function embedRequest(request) {
  const out = await callModel({
    role: 'model_3', system: SYSTEM, schema: SCHEMA,
    prompt: `Axes: ${AXES.join(', ')}\n\nRequest: """${request}"""`,
  });
  return normaliseVector(AXES.map((a) => Number(out?.weights?.[a]) || 0));
}

export function normaliseVector(v) {
  const clipped = v.map((x) => Math.min(1, Math.max(0, x)));
  const n = Math.hypot(...clipped);
  if (!n) throw new Error('model_3 returned an all-zero embedding');
  return clipped.map((x) => Math.round((x / n) * 1000) / 1000);
}
