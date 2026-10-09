// Scene: the textual scene format (design representation `scene`, medium formal).
// Shared by client and server. All tool steps that read or change the scene live here.

export type Vec3 = [number, number, number];

export type Geometry =
  | { shape: 'box'; width: number; height: number; depth: number }
  | { shape: 'sphere'; radius: number }
  | { shape: 'cylinder'; radiusTop: number; radiusBottom: number; height: number }
  | { shape: 'cone'; radius: number; height: number }
  | { shape: 'torus'; radius: number; tube: number }
  | { shape: 'capsule'; radius: number; length: number };

export type Shape = Geometry['shape'];

/** Required numeric dimensions per primitive, with defaults for new parts. */
export const SHAPE_DIMENSIONS: Record<Shape, Record<string, number>> = {
  box: { width: 1, height: 1, depth: 1 },
  sphere: { radius: 0.5 },
  cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1 },
  cone: { radius: 0.5, height: 1 },
  torus: { radius: 0.5, tube: 0.15 },
  capsule: { radius: 0.3, length: 1 },
};
export const SHAPES = Object.keys(SHAPE_DIMENSIONS) as Shape[];

export interface SceneNode {
  id: string;
  name: string;
  /** group = subassembly without its own geometry; part = has a primitive geometry. Both may have children. */
  kind: 'group' | 'part';
  geometry?: Geometry;
  /** Transforms are relative to the parent node. Rotation in degrees (XYZ Euler). */
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /** Hex color, parts only. */
  color?: string;
  children: SceneNode[];
}

export interface Scene {
  format: 'systemx-scene/1';
  title: string;
  root: SceneNode;
}

export const SCENE_FORMAT = 'systemx-scene/1' as const;

export class SceneError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid scene: ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? ` (+${problems.length - 6} more)` : ''}`);
  }
}

// ---------- validation / normalisation ----------

const MAX_NODES = 400;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'node'
  );
}

function normColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return null;
}

function normVec(v: unknown, def: number, path: string, problems: string[]): Vec3 {
  if (v === undefined || v === null) return [def, def, def];
  if (isNum(v)) return [v, v, v];
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return [v[0], v[1], v[2]];
  if (typeof v === 'object' && v && ['x', 'y', 'z'].every((k) => isNum((v as Record<string, unknown>)[k]))) {
    const o = v as Record<string, number>;
    return [o.x, o.y, o.z];
  }
  problems.push(`${path}: expected [x, y, z] numbers`);
  return [def, def, def];
}

function normGeometry(v: unknown, path: string, problems: string[]): Geometry | undefined {
  if (!v || typeof v !== 'object') {
    problems.push(`${path}.geometry: missing for part`);
    return undefined;
  }
  const g = v as Record<string, unknown>;
  const shape = g.shape as Shape;
  if (!SHAPES.includes(shape)) {
    problems.push(`${path}.geometry.shape: "${String(g.shape)}" is not one of ${SHAPES.join(', ')}`);
    return undefined;
  }
  const out: Record<string, unknown> = { shape };
  for (const [dim, def] of Object.entries(SHAPE_DIMENSIONS[shape])) {
    const d = g[dim];
    if (d === undefined) out[dim] = def;
    else if (isNum(d) && (d > 0 || (dim.startsWith('radius') && d >= 0))) out[dim] = d;
    else problems.push(`${path}.geometry.${dim}: must be a positive number`);
  }
  return out as Geometry;
}

/**
 * Validate an untrusted value (e.g. model output) and return a well-formed Scene.
 * Fills defaults for missing transforms, makes ids unique, and throws SceneError
 * listing all problems when the structure cannot be repaired.
 */
export function normalizeScene(raw: unknown): Scene {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') throw new SceneError(['scene must be a JSON object']);
  const r = raw as Record<string, unknown>;
  const rootRaw = r.root ?? (Array.isArray(r.children) ? r : undefined);
  if (!rootRaw) throw new SceneError(['scene.root is missing']);
  const used = new Set<string>();
  let count = 0;
  const root = normalizeNode(rootRaw, 'root', problems, used, () => ++count);
  if (count > MAX_NODES) problems.push(`scene has ${count} nodes (max ${MAX_NODES})`);
  if (problems.length) throw new SceneError(problems);
  root.kind = root.geometry ? root.kind : 'group';
  return {
    format: SCENE_FORMAT,
    title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : root.name,
    root,
  };
}

/** Normalise a single node subtree (used for model-returned fragments). */
export function normalizeNode(
  raw: unknown,
  path: string,
  problems: string[],
  used: Set<string>,
  tick: () => number = () => 0,
): SceneNode {
  tick();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`${path}: node must be an object`);
    return emptyGroup('invalid', used);
  }
  const n = raw as Record<string, unknown>;
  const name = typeof n.name === 'string' && n.name.trim() ? n.name.trim() : typeof n.id === 'string' ? n.id : 'Unnamed';
  const hasGeom = n.geometry !== undefined && n.geometry !== null;
  const kind: 'group' | 'part' = n.kind === 'group' ? 'group' : n.kind === 'part' || hasGeom ? 'part' : 'group';
  const here = `${path}(${name})`;
  const node: SceneNode = {
    id: uniqueId(typeof n.id === 'string' && n.id.trim() ? slug(n.id) : slug(name), used),
    name,
    kind,
    position: normVec(n.position, 0, `${here}.position`, problems),
    rotation: normVec(n.rotation, 0, `${here}.rotation`, problems),
    scale: normVec(n.scale, 1, `${here}.scale`, problems),
    children: [],
  };
  if (kind === 'part') {
    node.geometry = normGeometry(n.geometry, here, problems);
    node.color = normColor(n.color) ?? '#9aa4b2';
  }
  if (n.children !== undefined && !Array.isArray(n.children)) problems.push(`${here}.children: must be an array`);
  const kids = Array.isArray(n.children) ? n.children : [];
  node.children = kids.map((c, i) => normalizeNode(c, `${here}.children[${i}]`, problems, used, tick));
  return node;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let i = 2;
  while (used.has(id)) id = `${base}_${i++}`;
  used.add(id);
  return id;
}

function emptyGroup(name: string, used: Set<string>): SceneNode {
  return { id: uniqueId(slug(name), used), name, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], children: [] };
}

export function serializeScene(scene: Scene): string {
  return JSON.stringify(scene, null, 2);
}

/** Parse scene text (formal medium) into a validated Scene. */
export function parseScene(text: string): Scene {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SceneError([`not valid JSON: ${(e as Error).message}`]);
  }
  return normalizeScene(raw);
}

// ---------- queries ----------

export function walk(node: SceneNode, fn: (n: SceneNode, parent: SceneNode | null, depth: number) => void, parent: SceneNode | null = null, depth = 0) {
  fn(node, parent, depth);
  for (const c of node.children) walk(c, fn, node, depth + 1);
}

export function findNode(scene: Scene, id: string): SceneNode | null {
  let hit: SceneNode | null = null;
  walk(scene.root, (n) => {
    if (n.id === id) hit = n;
  });
  return hit;
}

export function findParent(scene: Scene, id: string): SceneNode | null {
  let hit: SceneNode | null = null;
  walk(scene.root, (n, p) => {
    if (n.id === id) hit = p;
  });
  return hit;
}

export function pathTo(scene: Scene, id: string): SceneNode[] {
  const out: SceneNode[] = [];
  const rec = (n: SceneNode): boolean => {
    out.push(n);
    if (n.id === id) return true;
    for (const c of n.children) if (rec(c)) return true;
    out.pop();
    return false;
  };
  return rec(scene.root) ? out : [];
}

/** linked_highlight: the selected node and all its descendants. */
export function subtreeIds(scene: Scene, id: string | null): Set<string> {
  const ids = new Set<string>();
  if (!id) return ids;
  const n = findNode(scene, id);
  if (n) walk(n, (m) => ids.add(m.id));
  return ids;
}

export function allIds(scene: Scene): Set<string> {
  const ids = new Set<string>();
  walk(scene.root, (n) => ids.add(n.id));
  return ids;
}

export function countNodes(scene: Scene): { parts: number; groups: number } {
  let parts = 0;
  let groups = 0;
  walk(scene.root, (n) => (n.kind === 'part' ? parts++ : groups++));
  return { parts, groups };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ---------- process 5: [tool extract] and [tool modify] ----------

/** subtree: the part of the scene description under the selected node. */
export function extractSubtree(scene: Scene, id: string): SceneNode {
  const n = findNode(scene, id);
  if (!n) throw new Error(`Node "${id}" not found`);
  return clone(n);
}

/**
 * Patch only the region under `targetId` with a replacement fragment (subtree_2).
 * The fragment is validated; its root keeps the target id, and ids that collide with
 * the rest of the scene are renamed.
 */
export function patchSubtree(scene: Scene, targetId: string, fragment: unknown): Scene {
  const next = clone(scene);
  const target = findNode(next, targetId);
  if (!target) throw new Error(`Node "${targetId}" not found`);
  const used = allIds(next);
  walk(target, (n) => used.delete(n.id));
  used.add(targetId);
  const problems: string[] = [];
  const fragObj = fragment && typeof fragment === 'object' ? { ...(fragment as object), id: targetId } : fragment;
  const usedForFrag = new Set(used);
  usedForFrag.delete(targetId);
  const replacement = normalizeNode(fragObj, targetId, problems, usedForFrag);
  if (problems.length) throw new SceneError(problems);
  replacement.id = targetId;
  if (targetId === next.root.id) return { ...next, root: replacement };
  const parent = findParent(next, targetId)!;
  parent.children = parent.children.map((c) => (c.id === targetId ? replacement : c));
  return next;
}

// ---------- process 3: [tool modify] for parameter_edit ----------

export type ParameterEdit =
  | { nodeId: string; field: 'name'; value: string }
  | { nodeId: string; field: 'color'; value: string }
  | { nodeId: string; field: 'position' | 'rotation' | 'scale'; axis: 0 | 1 | 2; value: number }
  | { nodeId: string; field: 'shape'; value: Shape }
  | { nodeId: string; field: 'dimension'; key: string; value: number };

export function applyParameterEdit(scene: Scene, edit: ParameterEdit): Scene {
  const next = clone(scene);
  const n = findNode(next, edit.nodeId);
  if (!n) throw new Error(`Node "${edit.nodeId}" not found`);
  switch (edit.field) {
    case 'name':
      n.name = edit.value.trim() || n.name;
      if (n.id === next.root.id) next.title = n.name;
      break;
    case 'color': {
      const c = normColor(edit.value);
      if (c && n.kind === 'part') n.color = c;
      break;
    }
    case 'position':
    case 'rotation':
    case 'scale':
      if (Number.isFinite(edit.value)) n[edit.field][edit.axis] = edit.value;
      break;
    case 'shape':
      if (n.kind === 'part' && SHAPES.includes(edit.value)) {
        n.geometry = { shape: edit.value, ...SHAPE_DIMENSIONS[edit.value] } as Geometry;
      }
      break;
    case 'dimension':
      if (n.geometry && edit.key in SHAPE_DIMENSIONS[n.geometry.shape] && Number.isFinite(edit.value) && edit.value >= 0) {
        (n.geometry as unknown as Record<string, number>)[edit.key] = edit.value;
      }
      break;
  }
  return next;
}

// ---------- process 4: [tool modify] for structure_edit ----------

export type StructureEdit =
  | { op: 'addPart'; parentId: string; shape?: Shape }
  | { op: 'addGroup'; parentId: string }
  | { op: 'delete'; nodeId: string }
  | { op: 'duplicate'; nodeId: string }
  | { op: 'moveUp'; nodeId: string }
  | { op: 'moveDown'; nodeId: string }
  | { op: 'indent'; nodeId: string }
  | { op: 'outdent'; nodeId: string }
  | { op: 'wrapInGroup'; nodeId: string }
  | { op: 'reparent'; nodeId: string; newParentId: string; index?: number };

export interface StructureResult {
  scene: Scene;
  /** node to select after the edit (e.g. the newly added one) */
  focusId: string | null;
}

export function applyStructureEdit(scene: Scene, edit: StructureEdit): StructureResult {
  const next = clone(scene);
  const used = allIds(next);
  const rootId = next.root.id;
  const nodeId = 'nodeId' in edit ? edit.nodeId : null;
  if (nodeId === rootId) throw new Error('The root assembly cannot be moved, duplicated or deleted');

  const parentOf = (id: string) => {
    const p = findParent(next, id);
    if (!p) throw new Error(`Node "${id}" not found`);
    return p;
  };

  switch (edit.op) {
    case 'addPart':
    case 'addGroup': {
      const parent = findNode(next, edit.parentId);
      if (!parent) throw new Error(`Node "${edit.parentId}" not found`);
      const isPart = edit.op === 'addPart';
      const shape = (isPart && edit.shape) || 'box';
      const name = isPart ? `New ${shape}` : 'New group';
      const n: SceneNode = {
        id: uniqueId(slug(name), used),
        name,
        kind: isPart ? 'part' : 'group',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
      };
      if (isPart) {
        n.geometry = { shape, ...SHAPE_DIMENSIONS[shape] } as Geometry;
        n.color = '#9aa4b2';
      }
      parent.children.push(n);
      return { scene: next, focusId: n.id };
    }
    case 'delete': {
      const p = parentOf(edit.nodeId);
      p.children = p.children.filter((c) => c.id !== edit.nodeId);
      return { scene: next, focusId: p.id };
    }
    case 'duplicate': {
      const p = parentOf(edit.nodeId);
      const idx = p.children.findIndex((c) => c.id === edit.nodeId);
      const copy = clone(p.children[idx]);
      walk(copy, (m) => (m.id = uniqueId(m.id, used)));
      copy.name = `${copy.name} copy`;
      p.children.splice(idx + 1, 0, copy);
      return { scene: next, focusId: copy.id };
    }
    case 'moveUp':
    case 'moveDown': {
      const p = parentOf(edit.nodeId);
      const i = p.children.findIndex((c) => c.id === edit.nodeId);
      const j = edit.op === 'moveUp' ? i - 1 : i + 1;
      if (j >= 0 && j < p.children.length) [p.children[i], p.children[j]] = [p.children[j], p.children[i]];
      return { scene: next, focusId: edit.nodeId };
    }
    case 'indent': {
      const p = parentOf(edit.nodeId);
      const i = p.children.findIndex((c) => c.id === edit.nodeId);
      if (i <= 0) throw new Error('No previous sibling to indent under');
      const [n] = p.children.splice(i, 1);
      p.children[i - 1].children.push(n);
      return { scene: next, focusId: n.id };
    }
    case 'outdent': {
      const p = parentOf(edit.nodeId);
      if (p.id === rootId) throw new Error('Already at the top level');
      const gp = parentOf(p.id);
      const i = p.children.findIndex((c) => c.id === edit.nodeId);
      const [n] = p.children.splice(i, 1);
      gp.children.splice(gp.children.findIndex((c) => c.id === p.id) + 1, 0, n);
      return { scene: next, focusId: n.id };
    }
    case 'wrapInGroup': {
      const p = parentOf(edit.nodeId);
      const i = p.children.findIndex((c) => c.id === edit.nodeId);
      const g: SceneNode = {
        id: uniqueId('group', used),
        name: `${p.children[i].name} group`,
        kind: 'group',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [p.children[i]],
      };
      p.children[i] = g;
      return { scene: next, focusId: g.id };
    }
    case 'reparent': {
      if (subtreeIds(next, edit.nodeId).has(edit.newParentId)) throw new Error('Cannot move a node into its own subtree');
      const target = findNode(next, edit.newParentId);
      if (!target) throw new Error(`Node "${edit.newParentId}" not found`);
      const p = parentOf(edit.nodeId);
      const i = p.children.findIndex((c) => c.id === edit.nodeId);
      const [n] = p.children.splice(i, 1);
      const at = edit.index === undefined ? target.children.length : Math.max(0, Math.min(edit.index, target.children.length));
      target.children.splice(at, 0, n);
      return { scene: next, focusId: n.id };
    }
  }
}
