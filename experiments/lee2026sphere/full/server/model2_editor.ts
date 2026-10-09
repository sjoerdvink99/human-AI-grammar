// model_2: large language model that resolves spatial references (translate) and
// decomposes the resolved command into atomic edit operations (decompose).
import { z } from 'zod';
import type { EditSubtask, InteractionState, ResolvedInstruction } from '../shared/types';
import { CATALOG, NAMED_COLORS } from '../shared/catalog';
import { callModel } from './llm';

const ResolvedSchema = z.object({
  command: z.string().min(1),
  references: z.array(z.object({ phrase: z.string(), resolvedTo: z.string() })),
});

const resolvedJsonSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'the command rewritten with every reference replaced by an object id or explicit (x, z) coordinates in metres' },
    references: { type: 'array', items: { type: 'object', properties: { phrase: { type: 'string' }, resolvedTo: { type: 'string' } }, required: ['phrase', 'resolvedTo'] } },
  },
  required: ['command', 'references'],
};

function describeTargets(state: InteractionState): string {
  if (!state.targets.length) return '(the user did not point at anything)';
  return state.targets
    .map((t, i) => `${i + 1}. ${t.kind === 'object' ? `object ${t.id} (${t.label})` : `floor position (x=${t.x.toFixed(2)}, z=${t.z.toFixed(2)})`}`)
    .join('\n');
}

function describeScene(state: InteractionState): string {
  const r = state.scene.room;
  return `Room: ${r.roomType}, ${r.width} m (x, west→east) by ${r.depth} m (z, north→south). Door on the south wall, window on the north wall.
Objects (id, type, centre x/z in metres, rotation in degrees where 0 faces south/+z, 90 faces east/+x):
${state.scene.objects.map((o) => `- ${o.id}: ${o.type} at (${o.x}, ${o.z}), rot ${o.rotation}`).join('\n')}`;
}

/** model_2 translate~: interaction_state → resolved_instruction. */
export async function resolveReferences(state: InteractionState): Promise<ResolvedInstruction> {
  const out = await callModel({
    role: 'model_2 translate',
    system: 'You resolve deictic and spatial references in spoken VR scene-editing commands. Answer only with the requested JSON.',
    prompt: `${describeScene(state)}

The user pointed with the VR controller at, in order:
${describeTargets(state)}

Spoken command (speech recognition transcript, may contain recognition errors): "${state.transcript}"

Resolve every reference such as "this", "that", "these", "here", "there", "it", "the chair", "next to the window" to a concrete object id from the list above or to explicit floor coordinates (x, z). Pointed targets are matched to references in the order they were pointed at ("this" → first pointed object, "there" → a pointed floor position). Rewrite the command so it no longer needs the pointing context. Do not invent objects that are not in the scene unless the command adds a new object.`,
    schema: ResolvedSchema,
    jsonSchema: resolvedJsonSchema,
  });
  return out;
}

const SubtaskSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), type: z.string(), x: z.number().optional(), z: z.number().optional(), near: z.string().optional(), color: z.string().optional() }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({ op: z.literal('move'), id: z.string(), x: z.number(), z: z.number() }),
  z.object({ op: z.literal('rotate'), id: z.string(), degrees: z.number(), absolute: z.boolean().optional() }),
  z.object({ op: z.literal('resize'), id: z.string(), factor: z.number() }),
  z.object({ op: z.literal('recolor'), id: z.string(), color: z.string() }),
]);
const SubtasksSchema = z.object({ subtasks: z.array(SubtaskSchema).max(20) });

const subtasksJsonSchema = {
  type: 'object',
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add', 'remove', 'move', 'rotate', 'resize', 'recolor'] },
          id: { type: 'string' }, type: { type: 'string' }, near: { type: 'string' },
          x: { type: 'number' }, z: { type: 'number' }, degrees: { type: 'number' }, absolute: { type: 'boolean' },
          factor: { type: 'number' }, color: { type: 'string' },
        },
        required: ['op'],
      },
    },
  },
  required: ['subtasks'],
};

/** model_2 decompose~: resolved_instruction → edit_subtasks (validated against the scene). */
export async function decomposeEdit(resolved: ResolvedInstruction, state: InteractionState): Promise<EditSubtask[]> {
  const ids = new Set(state.scene.objects.map((o) => o.id));
  const types = CATALOG.map((c) => c.type);
  const out = await callModel({
    role: 'model_2 decompose',
    system: 'You turn a resolved scene-editing command into a list of atomic edit operations. Answer only with the requested JSON.',
    prompt: `${describeScene(state)}

Resolved command: "${resolved.command}"
References: ${resolved.references.map((r) => `"${r.phrase}" → ${r.resolvedTo}`).join('; ') || 'none'}

Available operations (one object per operation):
- {"op":"add","type":<catalog type>,"x"?,"z"?,"near"?:<object id>,"color"?}
- {"op":"remove","id"}
- {"op":"move","id","x","z"}  (x, z are the new centre in metres inside the room)
- {"op":"rotate","id","degrees","absolute"?}  (relative turn unless absolute=true; 0 faces south, 90 east, 180 north, 270 west)
- {"op":"resize","id","factor"}  (0.3–3)
- {"op":"recolor","id","color"}  (a colour name: ${Object.keys(NAMED_COLORS).join(', ')}, or #rrggbb)
Catalog types: ${types.join(', ')}.
For "swap" or "exchange", use two moves. For "move X next to Y", compute coordinates beside Y without overlapping. Return an empty list if the command asks for nothing editable.`,
    schema: SubtasksSchema,
    jsonSchema: subtasksJsonSchema,
  });
  // validation where the representation is produced: ids must exist (or be added earlier in the list)
  const known = new Set(ids);
  const valid: EditSubtask[] = [];
  for (const t of out.subtasks as EditSubtask[]) {
    if (t.op === 'add') { if (types.includes(t.type)) valid.push(t); continue; }
    if (known.has(t.id)) valid.push(t);
  }
  return valid;
}
