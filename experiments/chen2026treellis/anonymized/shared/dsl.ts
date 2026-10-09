// Shape DSL: the formal artifact (r3) and its deterministic translation into
// the scene tree (r4: artifact graph) and parameter table (r6: artifact record).
// The rendered picture (r5: artifact visual) is produced by ./render.ts.

export type Value = number | string;

export interface Attr {
  raw: string; // source text as written in the program
  value: Value; // evaluated value
}

export type ShapeKind =
  | 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'polyline' | 'path' | 'text';
export type NodeKind = ShapeKind | 'group';

/** r4 node: one element of the scene tree. */
export interface SceneNode {
  id: string; // path of names, e.g. "house/roof"
  kind: NodeKind;
  name: string;
  attrs: Record<string, Attr>;
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive (closing brace for groups)
  children: SceneNode[];
}

/** r6 row: one declared parameter. */
export interface ParamRecord {
  name: string;
  type: 'number' | 'color' | 'string';
  raw: string;
  value: Value;
  min?: number;
  max?: number;
  line: number;
}

export interface Canvas {
  width: number;
  height: number;
  background: string;
  line: number;
}

export interface Program {
  canvas: Canvas;
  params: ParamRecord[]; // r6
  nodes: SceneNode[]; // r4 (roots)
}

export interface ParseError {
  line: number;
  message: string;
}

export type ParseResult =
  | { ok: true; program: Program }
  | { ok: false; errors: ParseError[] };

export const COMMON_ATTRS = ['fill', 'stroke', 'stroke_width', 'opacity', 'rotate'] as const;

export const KIND_ATTRS: Record<NodeKind, string[]> = {
  rect: ['x', 'y', 'w', 'h', 'rx'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polygon: ['points'],
  polyline: ['points'],
  path: ['d'],
  text: ['x', 'y', 'text', 'size', 'anchor', 'weight'],
  group: ['x', 'y', 'scale'],
};

export function allowedAttrs(kind: NodeKind): string[] {
  return [...KIND_ATTRS[kind], ...COMMON_ATTRS];
}

const STRING_ATTRS = new Set(['fill', 'stroke', 'points', 'd', 'text', 'anchor', 'weight']);
export function isStringAttr(attr: string): boolean {
  return STRING_ATTRS.has(attr);
}

// ---------------------------------------------------------------- tokens

export interface Token {
  text: string;
  start: number; // column offset in the line
  end: number;
}

/** Split a line on whitespace, keeping "quoted strings" and (parenthesised) parts intact. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    const start = i;
    let depth = 0;
    let inStr = false;
    while (i < line.length) {
      const c = line[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (/\s/.test(c) && depth === 0) break;
      i++;
    }
    tokens.push({ text: line.slice(start, i), start, end: i });
  }
  return tokens;
}

// ---------------------------------------------------------------- expressions

type Env = Map<string, Value>;

/** Evaluate an arithmetic expression: numbers, parameter names, + - * /, unary -, parentheses. */
export function evalExpr(src: string, env: Env): Value {
  let pos = 0;
  const s = src;
  const skip = () => { while (pos < s.length && /\s/.test(s[pos])) pos++; };
  const fail = (msg: string): never => { throw new Error(`${msg} in expression "${src}"`); };

  function primary(): Value {
    skip();
    const c = s[pos];
    if (c === '(') {
      pos++;
      const v = additive();
      skip();
      if (s[pos] !== ')') fail('missing ")"');
      pos++;
      return v;
    }
    if (c === '-') { pos++; const v = primary(); if (typeof v !== 'number') fail('cannot negate text'); return -(v as number); }
    if (c === '"') {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(s.slice(pos));
      if (!m) fail('unterminated string');
      pos += m![0].length;
      return unescape(m![1]);
    }
    const num = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(s.slice(pos));
    if (num) { pos += num[0].length; return parseFloat(num[0]); }
    const id = /^[A-Za-z_]\w*/.exec(s.slice(pos));
    if (id) {
      pos += id[0].length;
      if (!env.has(id[0])) fail(`unknown parameter "${id[0]}"`);
      return env.get(id[0])!;
    }
    return fail(`unexpected "${c ?? 'end'}"`);
  }
  function multiplicative(): Value {
    let v = primary();
    for (;;) {
      skip();
      const op = s[pos];
      if (op !== '*' && op !== '/') return v;
      pos++;
      const r = primary();
      if (typeof v !== 'number' || typeof r !== 'number') fail('arithmetic on text');
      v = op === '*' ? (v as number) * (r as number) : (v as number) / (r as number);
    }
  }
  function additive(): Value {
    let v = multiplicative();
    for (;;) {
      skip();
      const op = s[pos];
      if (op !== '+' && op !== '-') return v;
      pos++;
      const r = multiplicative();
      if (typeof v !== 'number' || typeof r !== 'number') fail('arithmetic on text');
      v = op === '+' ? (v as number) + (r as number) : (v as number) - (r as number);
    }
  }
  const v = additive();
  skip();
  if (pos < s.length) fail(`unexpected "${s[pos]}"`);
  return v;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

/** String literal with {expr} interpolation, e.g. "0,0 {w/2},10". */
function evalString(raw: string, env: Env): string {
  const inner = unescape(raw.slice(1, -1));
  return inner.replace(/\{([^}]*)\}/g, (_, e) => {
    const v = evalExpr(e, env);
    return typeof v === 'number' ? fmt(v) : v;
  });
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function evalValue(raw: string, env: Env): Value {
  if (raw.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(raw)) throw new Error(`unterminated string ${raw}`);
    return evalString(raw, env);
  }
  return evalExpr(raw, env);
}

// ---------------------------------------------------------------- parser

const PARAM_RE = /^param\s+([A-Za-z_]\w*)\s*=\s*(.+?)(?:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\])?\s*$/;
const KINDS = new Set<string>(Object.keys(KIND_ATTRS));

/** tool translate (part 1): program text r3 → scene tree r4 + parameter table r6. */
export function parseProgram(code: string): ParseResult {
  const lines = code.split('\n');
  const errors: ParseError[] = [];
  const env: Env = new Map();
  const params: ParamRecord[] = [];
  let canvas: Canvas | null = null;
  const roots: SceneNode[] = [];
  const stack: SceneNode[] = [];
  const usedIds = new Set<string>();

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    try {
      if (line === '}') {
        const g = stack.pop();
        if (!g) throw new Error('"}" without an open group');
        g.endLine = lineNo;
        return;
      }
      if (line.startsWith('param ')) {
        if (stack.length) throw new Error('param must be declared at top level');
        const m = PARAM_RE.exec(line);
        if (!m) throw new Error('expected: param name = value [min, max]');
        const [, name, rawVal, min, max] = m;
        if (env.has(name)) throw new Error(`parameter "${name}" declared twice`);
        const value = evalValue(rawVal.trim(), env);
        const type: ParamRecord['type'] =
          typeof value === 'number' ? 'number' : /^#[0-9a-f]{3,8}$/i.test(value) ? 'color' : 'string';
        env.set(name, value);
        params.push({
          name, type, raw: rawVal.trim(), value, line: lineNo,
          min: min !== undefined ? parseFloat(min) : undefined,
          max: max !== undefined ? parseFloat(max) : undefined,
        });
        return;
      }
      const tokens = tokenizeLine(line).map((t) => t.text);
      if (tokens[0] === 'canvas') {
        if (canvas) throw new Error('canvas declared twice');
        const w = Number(tokens[1]);
        const h = Number(tokens[2]);
        if (!(w > 0) || !(h > 0)) throw new Error('expected: canvas WIDTH HEIGHT background="#fff"');
        let background = '#ffffff';
        for (const t of tokens.slice(3)) {
          const [k, v] = splitAttr(t);
          if (k !== 'background') throw new Error(`unknown canvas attribute "${k}"`);
          background = String(evalValue(v, env));
        }
        canvas = { width: w, height: h, background, line: lineNo };
        return;
      }
      const kind = tokens[0];
      if (!KINDS.has(kind)) throw new Error(`unknown element kind "${kind}"`);
      let rest = tokens.slice(1);
      const opens = rest[rest.length - 1] === '{';
      if (opens) rest = rest.slice(0, -1);
      if (opens && kind !== 'group') throw new Error(`only groups can contain elements`);
      if (!opens && kind === 'group') throw new Error('group must end its line with "{"');
      const parent = stack[stack.length - 1];
      const siblings = parent ? parent.children : roots;
      let name = '';
      if (rest.length && !rest[0].includes('=')) {
        name = rest[0];
        rest = rest.slice(1);
        if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new Error(`invalid name "${name}"`);
      }
      if (!name) name = `${kind}${siblings.filter((s) => s.kind === kind).length + 1}`;
      let id = parent ? `${parent.id}/${name}` : name;
      if (usedIds.has(id)) { let k = 2; while (usedIds.has(`${id}~${k}`)) k++; id = `${id}~${k}`; }
      usedIds.add(id);
      const allowed = allowedAttrs(kind as NodeKind);
      const attrs: Record<string, Attr> = {};
      for (const t of rest) {
        const [k, v] = splitAttr(t);
        if (!allowed.includes(k)) throw new Error(`"${kind}" has no attribute "${k}" (allowed: ${allowed.join(', ')})`);
        attrs[k] = { raw: v, value: evalValue(v, env) };
      }
      const node: SceneNode = { id, kind: kind as NodeKind, name, attrs, startLine: lineNo, endLine: lineNo, children: [] };
      siblings.push(node);
      if (opens) stack.push(node);
    } catch (e) {
      errors.push({ line: lineNo, message: (e as Error).message });
    }
  });
  for (const g of stack) errors.push({ line: g.startLine, message: `group "${g.name}" is never closed with "}"` });
  if (!canvas) errors.push({ line: 1, message: 'missing "canvas WIDTH HEIGHT" line' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, program: { canvas: canvas!, params, nodes: roots } };
}

function splitAttr(token: string): [string, string] {
  const i = token.indexOf('=');
  if (i <= 0 || i === token.length - 1) throw new Error(`expected key=value, got "${token}"`);
  return [token.slice(0, i), token.slice(i + 1)];
}

export function findNode(nodes: SceneNode[], id: string): SceneNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return undefined;
}

export function formatErrors(errors: ParseError[]): string {
  return errors.map((e) => `line ${e.line}: ${e.message}`).join('\n');
}

/** Language reference given to the model (part of r2 / r15). */
export const DSL_SPEC = `Shape DSL — a line-based language for 2D vector drawings.
One statement per line. Lines starting with # are comments.

canvas WIDTH HEIGHT background="#rrggbb"      (required, exactly once, first line)
param NAME = VALUE [MIN, MAX]                   (top level; numbers get an optional slider range, colours are "#rrggbb" strings)
KIND NAME attr=value attr=value ...             (one element)
group NAME x=.. y=.. {                          (group; children on following lines; close with a line containing only })
}

Element kinds and their attributes (plus common: fill stroke stroke_width opacity rotate):
  rect     x y w h rx
  circle   cx cy r
  ellipse  cx cy rx ry
  line     x1 y1 x2 y2
  polygon  points        e.g. points="0,0 40,0 20,30"
  polyline points
  path     d             SVG path data, e.g. d="M0 0 C 10 10 20 10 30 0"
  text     x y text size anchor weight   (anchor: start|middle|end)
  group    x y scale     (translates/scales its children; rotate is in degrees about the centre)

Values: numbers, "strings", parameter names, or arithmetic without spaces like w/2+10 or in parentheses (w / 2 + 10).
Inside strings, {expr} is replaced by the value of expr, e.g. points="0,0 {w},0 {w/2},{h}".
Colours are "#rrggbb" or CSS names in quotes. A parameter used as a colour is written bare: fill=roof_color.
Give every element a short unique snake_case NAME. Coordinates are in pixels, origin top-left.`;
