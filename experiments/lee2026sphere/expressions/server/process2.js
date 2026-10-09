// Process 2: point at objects + speak -> resolved instruction -> edit subtasks -> executed on scene_1 (loops).
import { callModel } from './llm.js';
import { CATEGORIES } from './catalog.js';
import { sceneSummary, executeSubtasks } from './scene.js';

/** [tool_2 compose] targets_1 + transcript_1 (+ scene_1) -> interaction_state_1 */
export function composeInteractionState(scene, targets, transcript) {
  const ids = targets?.object_ids || [];
  return {
    transcript: (transcript || '').trim(),
    targets: ids.map((id) => scene.objects.find((o) => o.id === id)).filter(Boolean)
      .map(({ id, category, x, y, rot }) => ({ id, category, x, y, rot })),
    point: targets?.point && Number.isFinite(targets.point.x) ? { x: round(targets.point.x), y: round(targets.point.y) } : null,
    selection_order: ids,
  };
}

const RESOLVE_SYSTEM = `You are the instruction resolver of a room-layout editor (role: model_2).
The user pointed at objects and/or a floor location in a top-down plan and spoke a command.
Resolve every deictic or vague reference ("this", "that one", "here", "over there", "the other chair") using the
pointed targets (in the order they were selected) and the pointed floor point. Coordinates are metres; origin is the
top-left corner, x grows east (right), y grows south (down). rot is the direction the object's front faces: 0=south, 90=west, 180=north, 270=east.
Return JSON only.`;
const RESOLVE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['move', 'rotate', 'add', 'remove', 'resize', 'swap', 'rearrange', 'unclear'] },
    referents: { type: 'array', items: { type: 'object', properties: { phrase: { type: 'string' }, object_id: { type: 'string' } }, required: ['phrase', 'object_id'] } },
    location: { type: 'object', properties: { description: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
    parameters: { type: 'string', description: 'any amounts, directions, categories, or styles mentioned' },
    explanation: { type: 'string', description: 'one sentence restating the command with all references resolved' },
  },
  required: ['intent', 'referents', 'explanation'],
};

/** [model_2 translate]~ interaction_state_1 (+ scene_1) -> resolved_instruction_1 */
export async function resolveInstruction(scene, interactionState) {
  if (!interactionState.transcript) throw new Error('transcript_1 is empty: say or type a command');
  return callModel({
    role: 'model_2', system: RESOLVE_SYSTEM, schema: RESOLVE_SCHEMA,
    prompt: `Scene:\n${JSON.stringify(sceneSummary(scene))}\n\nInteraction state:\n${JSON.stringify(interactionState)}`,
  });
}

const SUBTASK_OPS = ['move', 'rotate', 'add', 'remove', 'resize', 'swap'];
const DECOMPOSE_SYSTEM = `You are the edit planner of a room-layout editor (role: model_2).
Decompose a resolved instruction into an ordered list of atomic edit subtasks on the scene.
Allowed ops: move {object_id, x?, y?, dx?, dy?, rot?}, rotate {object_id, rot? | drot?}, add {category, x, y, rot},
remove {object_id}, resize {object_id, scale}, swap {object_id, other_id}.
Use absolute coordinates in metres inside the room; keep objects inside the room and avoid overlaps.
To make an object face something, set rot so its front points at it: 0=south(+y), 90=west(-x), 180=north(-y), 270=east(+x).
Allowed categories for add: ${CATEGORIES.join(', ')}. Return JSON only.`;
const DECOMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: SUBTASK_OPS }, object_id: { type: 'string' }, other_id: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES }, x: { type: 'number' }, y: { type: 'number' },
          dx: { type: 'number' }, dy: { type: 'number' }, rot: { type: 'number' }, drot: { type: 'number' },
          scale: { type: 'number' }, rationale: { type: 'string' },
        },
        required: ['op'],
      },
    },
  },
  required: ['subtasks'],
};

/** [model_2 decompose]~ resolved_instruction_1 (+ scene_1) -> edit_subtasks_1* (validated) */
export async function decomposeInstruction(scene, resolved) {
  const out = await callModel({
    role: 'model_2', system: DECOMPOSE_SYSTEM, schema: DECOMPOSE_SCHEMA,
    prompt: `Scene:\n${JSON.stringify(sceneSummary(scene))}\n\nResolved instruction:\n${JSON.stringify(resolved)}`,
  });
  return validateSubtasks(scene, out?.subtasks || []);
}

export function validateSubtasks(scene, subtasks) {
  const ids = new Set(scene.objects.map((o) => o.id));
  const valid = [], rejected = [];
  for (const t of subtasks) {
    let why = null;
    if (!SUBTASK_OPS.includes(t.op)) why = `op ${t.op} not allowed`;
    else if (t.op === 'add' && !CATEGORIES.includes(t.category)) why = `unknown category ${t.category}`;
    else if (t.op !== 'add' && !ids.has(t.object_id)) why = `unknown object ${t.object_id}`;
    else if (t.op === 'swap' && !ids.has(t.other_id)) why = `unknown object ${t.other_id}`;
    if (why) rejected.push({ subtask: t, reason: why }); else valid.push(t);
    if (!why && t.op === 'add') ids.add(`${t.category}_new`);
  }
  return { valid, rejected };
}

/**
 * Runs one round of process 2 on a session. Returns the new scene and the round record appended to interaction_log_1.
 */
export async function runProcess2(session, { targets, transcript, speech_meta }, emit) {
  const scene = session.scene;
  const interaction_state = composeInteractionState(scene, targets, transcript);
  emit('tool_2 compose', { interaction_state });
  const resolved_instruction = await resolveInstruction(scene, interaction_state);
  emit('model_2 translate', { resolved_instruction });
  const { valid: edit_subtasks, rejected } = await decomposeInstruction(scene, resolved_instruction);
  emit('model_2 decompose', { edit_subtasks, rejected });
  const { scene: next, report } = executeSubtasks(scene, edit_subtasks);
  emit('tool_2 execute', { scene: next, report });
  const event = {
    t: Date.now(), type: 'edit', transcript: interaction_state.transcript, targets: interaction_state.targets.map((o) => o.id),
    point: interaction_state.point, speech: speech_meta || null, resolved_instruction, edit_subtasks, rejected, report,
  };
  return { scene: next, event };
}

const round = (x) => Math.round(x * 100) / 100;
