// Process 2: voice-driven editing of the scene (r14). model_1 (speech → text) runs in the browser.
import type { ComposedCommand, EditOp, Intent, Layout, Scene, SceneView, SpatialSelection } from '../shared/types.ts';
import { callModelJson } from './llm.ts';
import { composeCommand, executeOps } from './sceneEngine.ts';
import { asArray, asNumber, asObject, asString, type Emit } from './util.ts';

// model_2 is one role with one configuration (system prompt) used for two operations.
const MODEL_2_SYSTEM = `You are the command interpreter of a 2D top-down room editor.
Coordinates are in centimetres; x grows to the east (right), y grows to the south (down); rotation is degrees clockwise. At rot 0 an object's front faces south (+y); rot 90 faces west, 180 north, 270 east.
"Selected" objects are what the user pointed at; words like "this", "these", "it", "here" refer to the selection.
Output only JSON.`;

// ---------------------------------------------------------------- model_2 translate~: r19 (+ r14, r11, r15) → r20
export async function interpretCommand(cmd: ComposedCommand, view: SceneView): Promise<Intent> {
  const ids = new Set(cmd.objects.map((o) => o.id));
  const recent = view.editLog.slice(-3).map((e) => e.utterance);
  return callModelJson({
    role: 'model_2_translate',
    system: MODEL_2_SYSTEM,
    prompt: `Room: ${cmd.room.width} x ${cmd.room.depth} cm.\nAll objects: ${JSON.stringify(cmd.objects)}\nSelected objects: ${JSON.stringify(cmd.selection.objects)}${cmd.selection.region ? `\nSelected region: ${JSON.stringify(cmd.selection.region)}` : ''}\nRecent commands: ${JSON.stringify(recent)}\n\nSpoken command: """${cmd.utterance}"""\n\nTranslate the spoken command into a structured intent: the action in a few words (e.g. "move", "rotate", "arrange in a row", "remove", "recolor", "make bigger", "copy"), the ids of the target objects (resolve references to the selection or to named objects), and any parameters (directions, distances in cm, angles, colors as hex, alignment, spacing).\nReturn {"action": string, "targets": [object ids], "parameters": object, "explanation": string}.`,
  }, (v) => {
    const o = asObject(v);
    const targets = asArray(o.targets).map(String).filter((t) => ids.has(t));
    if (!targets.length) throw new Error('no valid target ids (use ids from the object list)');
    return { action: asString(o.action), targets, parameters: (o.parameters && typeof o.parameters === 'object' ? o.parameters : {}) as Record<string, unknown>, explanation: String(o.explanation ?? '') };
  });
}

// ---------------------------------------------------------------- model_2 decompose~: r20 (+ r14, r11) → r21*
const OPS = ['move', 'moveTo', 'rotate', 'scale', 'recolor', 'delete', 'duplicate'] as const;
export function validateOp(raw: unknown, ids: Set<string>): EditOp {
  const o = asObject(raw);
  const op = asString(o.op) as EditOp['op'];
  if (!OPS.includes(op)) throw new Error(`unknown op ${op}`);
  const target = asString(o.target);
  if (!ids.has(target)) throw new Error(`unknown target ${target}`);
  switch (op) {
    case 'move': return { op, target, dx: asNumber(o.dx ?? 0), dy: asNumber(o.dy ?? 0) };
    case 'moveTo': return { op, target, x: asNumber(o.x), y: asNumber(o.y) };
    case 'rotate': return { op, target, degrees: asNumber(o.degrees) };
    case 'scale': return { op, target, factor: asNumber(o.factor) };
    case 'recolor': { const c = asString(o.color); if (!/^#[0-9a-f]{3,8}$/i.test(c)) throw new Error('color must be hex'); return { op, target, color: c }; }
    case 'delete': return { op, target };
    case 'duplicate': return { op, target, dx: asNumber(o.dx ?? 60), dy: asNumber(o.dy ?? 0) };
  }
}

export async function decomposeIntent(intent: Intent, layout: Layout, scene: Scene): Promise<EditOp[]> {
  const ids = new Set(layout.map((o) => o.id));
  const objs = layout.map(({ id, name, x, y, w, h, rot }) => ({ id, name, x: Math.round(x), y: Math.round(y), w, h, rot }));
  return callModelJson({
    role: 'model_2_decompose',
    system: MODEL_2_SYSTEM,
    prompt: `Room: ${scene.room.width} x ${scene.room.depth} cm.\nObjects: ${JSON.stringify(objs)}\n\nIntent: ${JSON.stringify(intent)}\n\nDecompose the intent into a list of atomic edit operations, applied in order. Allowed operations:\n- {"op":"move","target":id,"dx":cm,"dy":cm}\n- {"op":"moveTo","target":id,"x":cm,"y":cm}   (center position)\n- {"op":"rotate","target":id,"degrees":deg}   (relative, clockwise)\n- {"op":"scale","target":id,"factor":number}\n- {"op":"recolor","target":id,"color":"#rrggbb"}\n- {"op":"delete","target":id}\n- {"op":"duplicate","target":id,"dx":cm,"dy":cm}\nKeep objects inside the room and avoid overlaps where you can.\nReturn {"ops": [...]}.`,
  }, (v) => {
    const ops = asArray(asObject(v).ops).map((op) => validateOp(op, ids));
    if (!ops.length) throw new Error('no operations');
    return ops;
  });
}

// ---------------------------------------------------------------- whole process (after human select / specify / model_1)
export async function runProcess2(
  input: { transcript: string; selection: SpatialSelection; scene: Scene; layout: Layout; view: SceneView },
  emit: Emit,
) {
  const { transcript, selection, scene, layout, view } = input;
  const r19 = await emit.step('r19', 'tool_2 compose', async () => composeCommand(transcript, selection, layout, scene));
  const r20 = await emit.step('r20', 'model_2 translate', () => interpretCommand(r19, view));
  const r21 = await emit.step('r21', 'model_2 decompose', () => decomposeIntent(r20, layout, scene));
  const r14 = await emit.step('r14', 'tool_2 execute', async () => executeOps(layout, r21, scene));
  const r15: SceneView = { ...view, editLog: [...view.editLog, { at: new Date().toISOString(), utterance: transcript, ops: r21 }] };
  return { layout: r14, view: r15, intent: r20, ops: r21 };
}
