// Deterministic `tool modify` steps: scene_1 + edit → scene_2 (canonical SceneScript).
import {
  ATTR_SPECS,
  AttrValue,
  CONTAINER_TYPES,
  NodeType,
  SceneNode,
  findNode,
  parseNode,
  parseScene,
  reindex,
  serializeNode,
} from './scene';

/** parameter_edit (instruction record) — process 3. */
export interface ParameterEdit {
  nodeId: string;
  /** an attribute key, or "name" to rename the node */
  key: string;
  value: AttrValue;
}

/** structure_edit (instruction record) — process 4. */
export type StructureEdit =
  | { op: 'add-child'; nodeId: string; childType: NodeType }
  | { op: 'delete'; nodeId: string }
  | { op: 'duplicate'; nodeId: string }
  | { op: 'move-up'; nodeId: string }
  | { op: 'move-down'; nodeId: string }
  | { op: 'wrap-in-group'; nodeId: string }
  | { op: 'unwrap-group'; nodeId: string };

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function done(root: SceneNode): string {
  return serializeNode(reindex(root)) + '\n';
}

function locate(root: SceneNode, nodeId: string): { parent: SceneNode; index: number } {
  const parts = nodeId.split('.').slice(1).map(Number);
  if (!parts.length) throw new Error('This operation is not possible on the scene root.');
  let parent = root;
  for (const i of parts.slice(0, -1)) parent = parent.children[i];
  const index = parts[parts.length - 1];
  if (!parent || !parent.children[index]) throw new Error(`Node ${nodeId} not found.`);
  return { parent, index };
}

export function applyParameterEdit(code: string, edit: ParameterEdit): string {
  const root = clone(parseScene(code));
  const n = findNode(root, edit.nodeId);
  if (!n) throw new Error(`Node ${edit.nodeId} not found.`);
  if (edit.key === 'name') {
    n.name = String(edit.value);
  } else {
    const spec = ATTR_SPECS[n.type][edit.key];
    if (!spec) throw new Error(`'${n.type}' has no parameter '${edit.key}'.`);
    n.attrs[edit.key] = edit.value;
  }
  // Re-parse the result so an invalid value can never enter the scene.
  const out = done(root);
  parseScene(out);
  return out;
}

const NEW_NODE_DEFAULTS: Partial<Record<NodeType, Record<string, AttrValue>>> = {
  box: { size: [0.5, 0.5, 0.5], color: '#4f8cc9' },
  sphere: { radius: 0.3, color: '#c94f6d' },
  cylinder: { radius: 0.2, height: 0.6, color: '#5bb07c' },
  cone: { radius: 0.25, height: 0.6, color: '#d9a441' },
  torus: { radius: 0.3, tube: 0.08, color: '#8f6bd1' },
  plane: { size: [2, 2], color: '#7a8590' },
};

/** Returns the new scene code and the id that should be selected afterwards. */
export function applyStructureEdit(code: string, edit: StructureEdit): { code: string; selectId: string } {
  const root = clone(parseScene(code));
  const target = findNode(root, edit.nodeId);
  if (!target) throw new Error(`Node ${edit.nodeId} not found.`);

  switch (edit.op) {
    case 'add-child': {
      if (!CONTAINER_TYPES.includes(target.type)) throw new Error('Only the scene and groups can have children.');
      const count = target.children.filter((c) => c.type === edit.childType).length;
      target.children.push({
        id: '',
        type: edit.childType,
        name: `${edit.childType} ${count + 1}`,
        attrs: { ...(NEW_NODE_DEFAULTS[edit.childType] ?? {}) },
        children: [],
        startLine: 0,
        endLine: 0,
      });
      return { code: done(root), selectId: `${edit.nodeId}.${target.children.length - 1}` };
    }
    case 'delete': {
      const { parent, index } = locate(root, edit.nodeId);
      parent.children.splice(index, 1);
      return { code: done(root), selectId: parent.id };
    }
    case 'duplicate': {
      const { parent, index } = locate(root, edit.nodeId);
      const copy = clone(target);
      copy.name = `${target.name} copy`;
      parent.children.splice(index + 1, 0, copy);
      return { code: done(root), selectId: `${parent.id}.${index + 1}` };
    }
    case 'move-up':
    case 'move-down': {
      const { parent, index } = locate(root, edit.nodeId);
      const j = edit.op === 'move-up' ? index - 1 : index + 1;
      if (j < 0 || j >= parent.children.length) return { code: done(root), selectId: edit.nodeId };
      [parent.children[index], parent.children[j]] = [parent.children[j], parent.children[index]];
      return { code: done(root), selectId: `${parent.id}.${j}` };
    }
    case 'wrap-in-group': {
      const { parent, index } = locate(root, edit.nodeId);
      parent.children[index] = {
        id: '',
        type: 'group',
        name: `${target.name} group`,
        attrs: {},
        children: [target],
        startLine: 0,
        endLine: 0,
      };
      return { code: done(root), selectId: `${parent.id}.${index}` };
    }
    case 'unwrap-group': {
      if (target.type !== 'group') throw new Error('Only groups can be unwrapped.');
      const { parent, index } = locate(root, edit.nodeId);
      // Unwrapping drops the group's own transform; warn by keeping it only if it is identity.
      const hasTransform = ['position', 'rotation', 'scale'].some((k) => k in target.attrs);
      if (hasTransform) throw new Error('Reset the group transform (position/rotation/scale) before unwrapping.');
      parent.children.splice(index, 1, ...target.children);
      return { code: done(root), selectId: parent.id };
    }
  }
}

/** tool modify (process 5): splice the model's subtree_2 into the scene in place of the target. */
export function replaceSubtree(code: string, nodeId: string, subtree: string): string {
  const root = clone(parseScene(code));
  const replacement = parseNode(subtree);
  if (nodeId === '0') {
    if (replacement.type !== 'scene') throw new Error("Replacement for the root must be a 'scene' node.");
    return done(replacement);
  }
  if (replacement.type === 'scene') throw new Error("Replacement subtree must not be a 'scene' node.");
  const { parent, index } = locate(root, nodeId);
  parent.children[index] = replacement;
  return done(root);
}
