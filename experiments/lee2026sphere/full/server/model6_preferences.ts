// model_6: large language model that expands the extracted context into a room → zone → object
// hierarchy (expand) and infers the user's design preferences as affordance statements (extract).
import { z } from 'zod';
import type { GraphRep, HierarchicalContext, SessionPayload } from '../shared/types';
import { CATALOG } from '../shared/catalog';
import { callModel } from './llm';
import { AFFORDANCE_TEMPLATES } from './tool4_context';

const HierSchema = z.object({
  room: z.object({
    summary: z.string(),
    zones: z.array(z.object({ name: z.string(), summary: z.string(), objects: z.array(z.object({ id: z.string(), role: z.string() })) })),
  }),
});
const hierJsonSchema = {
  type: 'object',
  properties: {
    room: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        zones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, summary: { type: 'string' },
              objects: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, role: { type: 'string' } }, required: ['id', 'role'] } },
            },
            required: ['name', 'summary', 'objects'],
          },
        },
      },
      required: ['summary', 'zones'],
    },
  },
  required: ['room'],
};

const graphText = (g: GraphRep) =>
  g.edges.map((e) => `${e.source} —${e.relation}${e.value !== undefined ? ` (${e.value} m)` : ''}→ ${e.target}`).join('\n');

/** model_6 expand~: geometric context → hierarchical context. */
export async function expandHierarchicalContext(geometric: GraphRep, payload: SessionPayload): Promise<HierarchicalContext> {
  const r = payload.scene.room;
  const zoneLabels = geometric.nodes.filter((n) => n.kind === 'zone').map((n) => `${n.id} = ${n.label}`).join(', ');
  const out = await callModel({
    role: 'model_6 expand',
    system: 'You describe indoor scenes hierarchically, from the room to functional zones to individual objects. Answer only with the requested JSON.',
    prompt: `A ${r.roomType.replace(/_/g, ' ')} of ${r.width} × ${r.depth} m (door on the south wall, window(s) on the ${r.windows.map((w) => w.wall).join(' and ')} wall).
Zones found by geometric analysis: ${zoneLabels}.
Spatial relations and connectivity:
${graphText(geometric)}

Describe the scene as a hierarchy: a one-sentence room summary, then each functional zone (you may rename zones to be more descriptive) with a one-sentence summary of how it is used and how it relates to the rest of the room, then each object id in that zone with its role in the zone. Every object id must appear exactly once.`,
    schema: HierSchema,
    jsonSchema: hierJsonSchema,
  });
  // validation: keep only real object ids, add missing ones to an "other" zone
  const ids = new Set(payload.scene.objects.map((o) => o.id));
  const seen = new Set<string>();
  for (const zone of out.room.zones) zone.objects = zone.objects.filter((o) => ids.has(o.id) && !seen.has(o.id) && seen.add(o.id));
  const missing = [...ids].filter((id) => !seen.has(id));
  if (missing.length) out.room.zones.push({ name: 'other', summary: 'Objects not assigned to a zone.', objects: missing.map((id) => ({ id, role: 'unassigned' })) });
  return out;
}

const AffSchema = z.object({ affordances: z.array(z.string().min(5)).min(1).max(10) });
const affJsonSchema = {
  type: 'object',
  properties: { affordances: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 } },
  required: ['affordances'],
};

/** model_6 extract~: hierarchical context (+ edit history) → affordance statements. */
export async function extractAffordances(hier: HierarchicalContext, payload: SessionPayload): Promise<string[]> {
  const edits = payload.interactionLog.entries
    .map((e, i) => `${i + 1}. "${e.transcript}" → ${e.subtasks.map((t) => JSON.stringify(t)).join(', ')}`)
    .join('\n') || '(no edits: the user accepted the generated layout)';
  const out = await callModel({
    role: 'model_6 extract',
    system: 'You infer reusable spatial design preferences of one user from a finished room layout and the edits they made. Answer only with the requested JSON.',
    prompt: `Original request: "${payload.request}"

Hierarchical description of the final scene:
${JSON.stringify(hier, null, 1)}

Edits the user made in VR (these reveal preferences most strongly):
${edits}

Infer 3–8 reusable spatial preferences (affordances) that should guide future rooms for this user. Prefer preferences supported by the user's edits, then by clear functional groupings. Write each one as a single sentence in exactly one of these forms, where <object> is one of the catalog types written with spaces (${CATALOG.map((c) => c.type.replace(/_/g, ' ')).join(', ')}):
${AFFORDANCE_TEMPLATES.map((t) => `- ${t}`).join('\n')}
You may append a short reason after "because".`,
    schema: AffSchema,
    jsonSchema: affJsonSchema,
  });
  return out.affordances;
}
