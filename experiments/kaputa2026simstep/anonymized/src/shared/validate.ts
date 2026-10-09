// Validators for generative outputs. Throw ValidationError with a message the model can act on.
import type { DataSpec, Graph, GraphEdit, Param } from './types';
import { ISSUE_CATEGORIES } from './types';

export class ValidationError extends Error {}

function fail(msg: string): never {
  throw new ValidationError(msg);
}

export function validateGraph(g: Graph, what = 'graph', minNodes = 2): Graph {
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) fail(`${what}: nodes and edges must be arrays`);
  if (g.nodes.length < minNodes) fail(`${what}: needs at least ${minNodes} nodes`);
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!n.id || typeof n.id !== 'string') fail(`${what}: every node needs a string id`);
    if (ids.has(n.id)) fail(`${what}: duplicate node id "${n.id}"`);
    ids.add(n.id);
    n.label = n.label || n.id;
    n.kind = n.kind || 'node';
    n.description = n.description || '';
  }
  const seen = new Set<string>();
  g.edges = g.edges.filter((e) => {
    const key = `${e.source}->${e.target}`;
    if (seen.has(key) || e.source === e.target) return false;
    seen.add(key);
    return true;
  });
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target))
      fail(`${what}: edge ${e.source} -> ${e.target} references a node that does not exist`);
  }
  return g;
}

/** model select over a graph: ids must be a non-empty subset; the subgraph is built here (deterministic). */
export function subgraph(g: Graph, nodeIds: string[]): Graph {
  const all = new Set(g.nodes.map((n) => n.id));
  const bad = nodeIds.filter((id) => !all.has(id));
  if (bad.length) fail(`unknown node ids: ${bad.join(', ')}`);
  if (!nodeIds.length) fail('select at least one node');
  const keep = new Set(nodeIds);
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

export function validateTextList(items: string[], what: string, min = 2, max = 6): string[] {
  if (!Array.isArray(items)) fail(`${what}: must be an array`);
  const clean = items.map((s) => String(s).trim()).filter(Boolean);
  if (clean.length < min) fail(`${what}: need at least ${min} items`);
  return clean.slice(0, max);
}

export function validateDataSpec(d: DataSpec): DataSpec {
  if (!Array.isArray(d.fields) || !d.fields.length) fail('dataSpec: at least one field');
  if (!Array.isArray(d.sample) || d.sample.length < 3) fail('dataSpec: sample needs at least 3 rows');
  const names = d.fields.map((f) => f.name);
  for (const [i, row] of d.sample.entries()) {
    for (const n of names) if (!(n in row)) fail(`dataSpec: sample row ${i} is missing field "${n}"`);
  }
  return d;
}

export function validateCode(code: string): string {
  if (typeof code !== 'string' || !code.trim()) fail('code is empty');
  let c = code.trim();
  const fence = c.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fence) c = fence[1];
  if (!/function\s+render\s*\(/.test(c)) fail('code must define `function render(svg, data)`');
  if (!/SAMPLE_DATA/.test(c)) fail('code must define `const SAMPLE_DATA = [...]`');
  if (/\bimport\s+[\w{*]|\brequire\s*\(/.test(c)) fail('code must not import or require libraries');
  try {
    // syntax check only; never executed on the server
    new Function(c);
  } catch (e) {
    fail(`code has a syntax error: ${(e as Error).message}`);
  }
  return c;
}

export function validateCategory(c: string): string {
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(c)) fail(`category must be one of ${ISSUE_CATEGORIES.join(', ')}`);
  return c;
}

export function validateGraphEdit(edit: GraphEdit, g: Graph): GraphEdit {
  const e: GraphEdit = {
    addNodes: edit.addNodes ?? [],
    updateNodes: edit.updateNodes ?? [],
    removeNodeIds: edit.removeNodeIds ?? [],
    addEdges: edit.addEdges ?? [],
    removeEdges: edit.removeEdges ?? [],
  };
  const existing = new Set(g.nodes.map((n) => n.id));
  for (const n of e.updateNodes) if (!existing.has(n.id)) fail(`updateNodes: unknown node "${n.id}"`);
  for (const id of e.removeNodeIds) if (!existing.has(id)) fail(`removeNodeIds: unknown node "${id}"`);
  for (const n of e.addNodes) if (existing.has(n.id)) fail(`addNodes: id "${n.id}" already exists`);
  const total = e.addNodes.length + e.updateNodes.length + e.removeNodeIds.length + e.addEdges.length + e.removeEdges.length;
  if (!total) fail('graph edit is empty');
  return e;
}

export function validateParams(params: Param[]): Param[] {
  if (!Array.isArray(params) || !params.length) fail('at least one parameter');
  const kinds = ['number', 'color', 'string', 'boolean'];
  return params.map((p) => ({
    name: String(p.name),
    kind: (kinds.includes(p.kind) ? p.kind : 'string') as Param['kind'],
    value: String(p.value),
    description: String(p.description ?? ''),
  }));
}
