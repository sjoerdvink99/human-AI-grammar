// SceneScript: a small declarative scene language (the `scene` representation, medium: formal).
//
//   scene "Desk setup" {
//     group "desk" position=[0, 0, 0] {
//       box "top" size=[1.6, 0.06, 0.8] position=[0, 0.75, 0] color=#8b5a2b
//       cylinder "leg" radius=0.03 height=0.75 position=[0.7, 0.375, 0.35] color=#333333
//     }
//   }
//
// node  := TYPE STRING attr* ( "{" node* "}" )?
// attr  := IDENT "=" value
// value := number | "[" number ("," number)* "]" | #hex color | STRING
// Line comments start with //.

export const NODE_TYPES = ['scene', 'group', 'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const CONTAINER_TYPES: NodeType[] = ['scene', 'group'];
export const PRIMITIVE_TYPES: NodeType[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'];

export type AttrValue = number | number[] | string;

export interface AttrSpec {
  kind: 'vec3' | 'vec2' | 'number' | 'color' | 'string';
  default: AttrValue;
  min?: number;
  step?: number;
}

const TRANSFORM: Record<string, AttrSpec> = {
  position: { kind: 'vec3', default: [0, 0, 0], step: 0.05 },
  rotation: { kind: 'vec3', default: [0, 0, 0], step: 5 },
  scale: { kind: 'vec3', default: [1, 1, 1], step: 0.05, min: 0 },
};
const MATERIAL: Record<string, AttrSpec> = {
  color: { kind: 'color', default: '#9aa5b1' },
  opacity: { kind: 'number', default: 1, min: 0, step: 0.05 },
  metalness: { kind: 'number', default: 0.1, min: 0, step: 0.05 },
  roughness: { kind: 'number', default: 0.7, min: 0, step: 0.05 },
};

/** Which attributes each node type accepts, in display order. */
export const ATTR_SPECS: Record<NodeType, Record<string, AttrSpec>> = {
  scene: { background: { kind: 'color', default: '#1e2329' } },
  group: { ...TRANSFORM },
  box: { size: { kind: 'vec3', default: [1, 1, 1], step: 0.05, min: 0 }, ...TRANSFORM, ...MATERIAL },
  sphere: { radius: { kind: 'number', default: 0.5, step: 0.05, min: 0 }, ...TRANSFORM, ...MATERIAL },
  cylinder: {
    radius: { kind: 'number', default: 0.5, step: 0.05, min: 0 },
    height: { kind: 'number', default: 1, step: 0.05, min: 0 },
    ...TRANSFORM,
    ...MATERIAL,
  },
  cone: {
    radius: { kind: 'number', default: 0.5, step: 0.05, min: 0 },
    height: { kind: 'number', default: 1, step: 0.05, min: 0 },
    ...TRANSFORM,
    ...MATERIAL,
  },
  torus: {
    radius: { kind: 'number', default: 0.5, step: 0.05, min: 0 },
    tube: { kind: 'number', default: 0.15, step: 0.01, min: 0 },
    ...TRANSFORM,
    ...MATERIAL,
  },
  plane: { size: { kind: 'vec2', default: [1, 1], step: 0.1, min: 0 }, ...TRANSFORM, ...MATERIAL },
};

/** A node of the structure tree (structure_tree, medium: graph). */
export interface SceneNode {
  /** Path-based id: "0" is the scene root, "0.2.1" its third child's second child. */
  id: string;
  type: NodeType;
  name: string;
  attrs: Record<string, AttrValue>;
  children: SceneNode[];
  /** 1-based source lines of this node in the canonical scene code. */
  startLine: number;
  endLine: number;
}

export class SceneParseError extends Error {
  constructor(message: string, public line: number) {
    super(`Line ${line}: ${message}`);
  }
}

// ---------------------------------------------------------------- tokenizer

type Tok =
  | { t: 'ident'; v: string; line: number }
  | { t: 'string'; v: string; line: number }
  | { t: 'number'; v: number; line: number }
  | { t: 'color'; v: string; line: number }
  | { t: 'punct'; v: string; line: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if ('{}[]=,'.includes(c)) { toks.push({ t: 'punct', v: c, line }); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') throw new SceneParseError('unterminated string', line);
        s += src[j++];
      }
      if (j >= src.length) throw new SceneParseError('unterminated string', line);
      toks.push({ t: 'string', v: s, line });
      i = j + 1;
      continue;
    }
    if (c === '#') {
      const m = /^#[0-9a-fA-F]{6}\b|^#[0-9a-fA-F]{3}\b/.exec(src.slice(i));
      if (!m) throw new SceneParseError('invalid color (use #rrggbb)', line);
      toks.push({ t: 'color', v: normalizeColor(m[0]), line });
      i += m[0].length;
      continue;
    }
    const num = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?/i.exec(src.slice(i));
    if (num) { toks.push({ t: 'number', v: parseFloat(num[0]), line }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { toks.push({ t: 'ident', v: id[0], line }); i += id[0].length; continue; }
    throw new SceneParseError(`unexpected character '${c}'`, line);
  }
  return toks;
}

function normalizeColor(c: string): string {
  c = c.toLowerCase();
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  return c;
}

// ------------------------------------------------------------------- parser

/** Parses exactly one node (with its subtree). Used for full scenes and for subtrees. */
export function parseNode(src: string, rootId = '0'): SceneNode {
  const toks = tokenize(src);
  let p = 0;
  const lastLine = () => (toks.length ? toks[toks.length - 1].line : 1);
  const peek = () => toks[p];
  const next = () => {
    const t = toks[p++];
    if (!t) throw new SceneParseError('unexpected end of input', lastLine());
    return t;
  };
  const expectPunct = (v: string) => {
    const t = next();
    if (t.t !== 'punct' || t.v !== v) throw new SceneParseError(`expected '${v}'`, t.line);
  };

  function value(): AttrValue {
    const t = next();
    if (t.t === 'number' || t.t === 'string' || t.t === 'color') return t.v;
    if (t.t === 'punct' && t.v === '[') {
      const arr: number[] = [];
      for (;;) {
        const n = next();
        if (n.t !== 'number') throw new SceneParseError('expected number in list', n.line);
        arr.push(n.v);
        const sep = next();
        if (sep.t === 'punct' && sep.v === ']') break;
        if (!(sep.t === 'punct' && sep.v === ',')) throw new SceneParseError("expected ',' or ']'", sep.line);
      }
      return arr;
    }
    throw new SceneParseError('expected a value', t.line);
  }

  function node(id: string): SceneNode {
    const typeTok = next();
    if (typeTok.t !== 'ident' || !(NODE_TYPES as readonly string[]).includes(typeTok.v))
      throw new SceneParseError(`expected a node type (${NODE_TYPES.join(', ')})`, typeTok.line);
    const type = typeTok.v as NodeType;
    const nameTok = next();
    if (nameTok.t !== 'string') throw new SceneParseError(`expected a quoted name after '${type}'`, nameTok.line);
    const specs = ATTR_SPECS[type];
    const attrs: Record<string, AttrValue> = {};
    while (peek() && peek().t === 'ident' && toks[p + 1]?.t === 'punct' && toks[p + 1].v === '=') {
      const key = next() as Tok & { v: string };
      next();
      const v = value();
      const spec = specs[key.v];
      if (!spec) throw new SceneParseError(`'${type}' has no attribute '${key.v}'`, key.line);
      attrs[key.v] = coerce(spec, v, key.line, key.v);
    }
    const children: SceneNode[] = [];
    let endLine = toks[p - 1].line;
    const t = peek();
    if (t && t.t === 'punct' && t.v === '{') {
      if (!CONTAINER_TYPES.includes(type)) throw new SceneParseError(`'${type}' cannot have children`, t.line);
      next();
      while (!(peek() && peek().t === 'punct' && peek().v === '}')) {
        if (!peek()) throw new SceneParseError("missing '}'", lastLine());
        children.push(node(`${id}.${children.length}`));
      }
      endLine = next().line;
    }
    return { id, type, name: nameTok.v, attrs, children, startLine: typeTok.line, endLine };
  }

  if (!toks.length) throw new SceneParseError('empty scene', 1);
  const root = node(rootId);
  if (p < toks.length) throw new SceneParseError('unexpected content after the node', toks[p].line);
  return root;
}

function coerce(spec: AttrSpec, v: AttrValue, line: number, key: string): AttrValue {
  switch (spec.kind) {
    case 'vec3':
      if (typeof v === 'number') return [v, v, v];
      if (Array.isArray(v) && v.length === 3) return v;
      throw new SceneParseError(`'${key}' must be [x, y, z]`, line);
    case 'vec2':
      if (Array.isArray(v) && v.length === 2) return v;
      throw new SceneParseError(`'${key}' must be [w, d]`, line);
    case 'number':
      if (typeof v === 'number') return v;
      throw new SceneParseError(`'${key}' must be a number`, line);
    case 'color':
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v)) return v;
      throw new SceneParseError(`'${key}' must be a #rrggbb color`, line);
    case 'string':
      if (typeof v === 'string') return v;
      throw new SceneParseError(`'${key}' must be a string`, line);
  }
}

/** Parses a full scene; the root must be a `scene` node. */
export function parseScene(src: string): SceneNode {
  const root = parseNode(src);
  if (root.type !== 'scene') throw new SceneParseError("the top-level node must be 'scene'", root.startLine);
  return root;
}

// --------------------------------------------------------------- serializer

function fmtNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
function fmtValue(v: AttrValue): string {
  if (typeof v === 'number') return fmtNum(v);
  if (Array.isArray(v)) return `[${v.map(fmtNum).join(', ')}]`;
  if (v.startsWith('#')) return v;
  return JSON.stringify(v);
}

/** Canonical formatting of a node. Every scene version is stored in this form. */
export function serializeNode(n: SceneNode, indent = 0): string {
  const pad = '  '.repeat(indent);
  const order = Object.keys(ATTR_SPECS[n.type]);
  const attrs = order.filter((k) => k in n.attrs).map((k) => `${k}=${fmtValue(n.attrs[k])}`);
  let head = `${pad}${n.type} ${JSON.stringify(n.name)}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (!CONTAINER_TYPES.includes(n.type)) return head;
  if (!n.children.length) return head + ' {\n' + pad + '}';
  return head + ' {\n' + n.children.map((c) => serializeNode(c, indent + 1)).join('\n') + '\n' + pad + '}';
}

/** Parse + re-serialize so line spans and formatting are stable. */
export function canonicalize(src: string): string {
  return serializeNode(parseScene(src)) + '\n';
}

// ---------------------------------------------------------- translate step

export type NodeParams = { id: string; type: NodeType; name: string; attrs: Record<string, AttrValue> };

/** The `parameters` representation: editable attributes for every node, defaults filled in. */
export function extractParameters(root: SceneNode): Record<string, NodeParams> {
  const out: Record<string, NodeParams> = {};
  walk(root, (n) => {
    const attrs: Record<string, AttrValue> = {};
    for (const [k, spec] of Object.entries(ATTR_SPECS[n.type])) attrs[k] = n.attrs[k] ?? spec.default;
    out[n.id] = { id: n.id, type: n.type, name: n.name, attrs };
  });
  return out;
}

/** tool translate: scene code → structure tree + parameters (the 3D view renders from the tree). */
export function translateScene(code: string): { tree: SceneNode; parameters: Record<string, NodeParams> } {
  const tree = parseScene(code);
  return { tree, parameters: extractParameters(tree) };
}

// ---------------------------------------------------------------- helpers

export function walk(n: SceneNode, f: (n: SceneNode, parent?: SceneNode) => void, parent?: SceneNode) {
  f(n, parent);
  n.children.forEach((c) => walk(c, f, n));
}

export function findNode(root: SceneNode, id: string): SceneNode | undefined {
  let found: SceneNode | undefined;
  walk(root, (n) => { if (n.id === id) found = n; });
  return found;
}

export function findParent(root: SceneNode, id: string): SceneNode | undefined {
  let found: SceneNode | undefined;
  walk(root, (n, parent) => { if (n.id === id) found = parent; });
  return found;
}

/** Innermost node whose source span contains `line` (for selecting from the code view). */
export function nodeAtLine(root: SceneNode, line: number): SceneNode | undefined {
  let best: SceneNode | undefined;
  walk(root, (n) => { if (n.startLine <= line && line <= n.endLine) best = n; });
  return best;
}

/** Reassigns path-based ids after a structural change. */
export function reindex(n: SceneNode, id = '0'): SceneNode {
  return { ...n, id, children: n.children.map((c, i) => reindex(c, `${id}.${i}`)) };
}

/** tool extract: the source code of one node and its descendants (the `subtree` representation). */
export function extractSubtree(code: string, nodeId: string): string {
  const root = parseScene(code);
  const n = findNode(root, nodeId);
  if (!n) throw new Error(`node ${nodeId} not found`);
  return serializeNode(n) + '\n';
}
