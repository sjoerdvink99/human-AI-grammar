// Process 3: learn reusable composite assets from a finished scene and train the reliability model.
import type {
  Asset, AssetScore, CompositeMember, Graph, Judgement, Layout, Library, ObjectRow, Reliability, Scene, SceneSnapshot, SceneView, Verdict,
} from '../shared/types.ts';
import { AXES } from '../shared/types.ts';
import { callModelJson } from './llm.ts';
import { lexiconVector, reliabilityOf } from './library.ts';
import { renderThumbnails } from './render.ts';
import { asArray, asObject, asString, type Emit } from './util.ts';

const ADJACENT_GAP_CM = 45;
const MAX_GROUP = 8;

// ---------------------------------------------------------------- tool_4 compose: r14 + r15 + r11 → r22
export const snapshotScene = (scene: Scene, layout: Layout, view: SceneView): SceneSnapshot => ({ scene, layout, view });

// ---------------------------------------------------------------- tool_4 extract: r22 → r23
export const objectTable = (snap: SceneSnapshot): ObjectRow[] =>
  snap.layout.map(({ id, assetId, name, x, y, w, h, rot, color }) => ({ id, assetId, name, x: Math.round(x), y: Math.round(y), w, h, rot, color }));

// ---------------------------------------------------------------- tool_4 assign: r23 → r24
const box = (r: ObjectRow) => (r.rot % 180 === 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : { x: r.x, y: r.y, w: r.h, h: r.w });
export function gap(a: ObjectRow, b: ObjectRow) {
  const A = box(a), B = box(b);
  const gx = Math.max(0, Math.abs(A.x - B.x) - (A.w + B.w) / 2);
  const gy = Math.max(0, Math.abs(A.y - B.y) - (A.h + B.h) / 2);
  return Math.hypot(gx, gy);
}
const FLOOR = new Set(['rug', 'play_mat']);
export function assignRelations(rows: ObjectRow[]): Graph {
  const g: Graph = { nodes: rows.map((r) => ({ id: r.id, label: r.name, data: { ...r } })), edges: [] };
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (FLOOR.has(a.assetId) || FLOOR.has(b.assetId)) continue; // floor coverings touch everything
    const d = gap(a, b);
    if (d <= ADJACENT_GAP_CM) g.edges.push({ source: a.id, target: b.id, relation: d < 5 ? 'touching' : 'adjacent' });
  }
  return g;
}

// ---------------------------------------------------------------- tool_4 extract: r24 → r25
export function extractGroups(g: Graph): Graph {
  const adj = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) { adj.get(e.source)!.push(e.target); adj.get(e.target)!.push(e.source); }
  const seen = new Set<string>();
  const out: Graph = { nodes: [], edges: [] };
  let k = 0;
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue;
    const comp: string[] = []; const stack = [n.id];
    while (stack.length) { const c = stack.pop()!; if (seen.has(c)) continue; seen.add(c); comp.push(c); stack.push(...adj.get(c)!); }
    if (comp.length < 2 || comp.length > MAX_GROUP) continue;
    const gid = `group_${++k}`;
    out.nodes.push({ id: gid, label: 'group' });
    for (const id of comp) {
      out.nodes.push(g.nodes.find((x) => x.id === id)!);
      out.edges.push({ source: gid, target: id, relation: 'member' });
    }
    out.edges.push(...g.edges.filter((e) => comp.includes(e.source) && comp.includes(e.target)));
  }
  return out;
}

const groupsOf = (g: Graph) => g.nodes.filter((n) => n.label === 'group' || n.id.startsWith('group_')).map((gn) => ({
  id: gn.id,
  node: gn,
  members: g.edges.filter((e) => e.source === gn.id && e.relation === 'member').map((e) => g.nodes.find((n) => n.id === e.target)!).filter(Boolean),
}));

// ---------------------------------------------------------------- model_6 expand~: r25 → r26
export async function expandGroups(g: Graph, scene: Scene): Promise<Graph> {
  const groups = groupsOf(g);
  if (!groups.length) return g;
  const payload = groups.map((gr) => ({
    groupId: gr.id,
    members: gr.members.map((m) => { const d = m.data as unknown as ObjectRow; return { id: m.id, name: m.label, x: d.x, y: d.y, w: d.w, h: d.h, rot: d.rot }; }),
    adjacency: g.edges.filter((e) => e.relation !== 'member' && gr.members.some((m) => m.id === e.source)).map((e) => [e.source, e.relation, e.target]),
  }));
  const res = await callModelJson({
    role: 'model_6_expand',
    system: 'You analyse furniture arrangements in a 2D room plan (cm; y grows downward; rot is degrees clockwise; at rot 0 an object\'s front faces south). Output only JSON.',
    prompt: `The scene was made for: """${scene.request}"""\n\nGroups of adjacent objects:\n${JSON.stringify(payload, null, 1)}\n\nExpand each group graph: give the arrangement a short reusable name, its function, and a semantic relation for each adjacency pair (e.g. "faces", "beside", "lights", "serves", "under"). Also say whether it is a coherent reusable arrangement (coherent=false for accidental clusters).\nReturn {"groups": [{"groupId": string, "name": string, "function": string, "coherent": boolean, "relations": [{"source": id, "target": id, "relation": string}]}]}.`,
  }, (v) => asArray(asObject(v).groups).map((x) => {
    const o = asObject(x);
    return { groupId: asString(o.groupId), name: asString(o.name), function: String(o.function ?? ''), coherent: o.coherent !== false, relations: Array.isArray(o.relations) ? o.relations.map((r) => asObject(r)) : [] };
  }));
  const out: Graph = { nodes: g.nodes.map((n) => ({ ...n })), edges: g.edges.filter((e) => e.relation === 'member') };
  for (const gr of groups) {
    const r = res.find((x) => x.groupId === gr.id);
    const node = out.nodes.find((n) => n.id === gr.id)!;
    if (!r || !r.coherent) { node.data = { coherent: false }; continue; }
    node.data = { name: r.name, function: r.function, coherent: true };
    const memberIds = new Set(gr.members.map((m) => m.id));
    for (const rel of r.relations) {
      const s = String(rel.source), t = String(rel.target);
      if (memberIds.has(s) && memberIds.has(t)) out.edges.push({ source: s, target: t, relation: String(rel.relation ?? 'related') });
    }
  }
  return out;
}

// ---------------------------------------------------------------- model_6 extract~: r26 → r27*
export interface Description { groupId: string; text: string } // r27 item (language) with provenance kept in code
export async function describeAssets(g: Graph): Promise<Description[]> {
  const groups = groupsOf(g).filter((gr) => (gr.node.data as { coherent?: boolean } | undefined)?.coherent);
  if (!groups.length) return [];
  const payload = groups.map((gr) => ({
    groupId: gr.id, ...(gr.node.data as object),
    members: gr.members.map((m) => m.label),
    relations: g.edges.filter((e) => e.relation !== 'member' && gr.members.some((m) => m.id === e.source)).map((e) => `${g.nodes.find((n) => n.id === e.source)?.label} ${e.relation} ${g.nodes.find((n) => n.id === e.target)?.label}`),
  }));
  return callModelJson({
    role: 'model_6_extract',
    system: 'You write catalogue entries for reusable furniture arrangements. Output only JSON.',
    prompt: `Arrangement graphs:\n${JSON.stringify(payload, null, 1)}\n\nFor each arrangement write one catalogue entry as a single line of text: "<Name> — <one or two sentences describing what it contains, how it is arranged and what it is for, using plain furniture words>".\nReturn {"assets": [{"groupId": string, "text": string}]}.`,
  }, (v) => asArray(asObject(v).assets).map((x) => {
    const o = asObject(x);
    return { groupId: asString(o.groupId), text: asString(o.text) };
  }).filter((d) => groups.some((gr) => gr.id === d.groupId)));
}

// ---------------------------------------------------------------- tool_4 translate: r27* → r28*
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
export function toAssetRecords(descriptions: Description[], g: Graph, library: Library, scene: Scene): Asset[] {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const groups = groupsOf(g);
  return descriptions.flatMap((d) => {
    const gr = groups.find((x) => x.id === d.groupId);
    if (!gr) return [];
    const rows = gr.members.map((m) => m.data as unknown as ObjectRow);
    // Normalise orientation: the side nearest a wall becomes "north" (rot 0), matching wall placement.
    const cx = rows.reduce((s, r) => s + r.x, 0) / rows.length, cy = rows.reduce((s, r) => s + r.y, 0) / rows.length;
    const dists = [cy, scene.room.width - cx, scene.room.depth - cy, cx]; // N E S W
    const wall = dists.indexOf(Math.min(...dists));
    const nearWall = Math.min(...dists) < 150;
    const turn = nearWall ? [0, -90, 180, 90][wall] : 0;
    const rad = (turn * Math.PI) / 180;
    const members: CompositeMember[] = rows.map((r) => ({
      assetId: r.assetId,
      dx: Math.round((r.x - cx) * Math.cos(rad) - (r.y - cy) * Math.sin(rad)),
      dy: Math.round((r.x - cx) * Math.sin(rad) + (r.y - cy) * Math.cos(rad)),
      rot: (((r.rot + turn) % 360) + 360) % 360,
      color: r.color,
    }));
    const ext = members.map((m) => { const a = byId.get(m.assetId); const f = m.rot % 180 === 0 ? { w: a?.w ?? 50, h: a?.h ?? 50 } : { w: a?.h ?? 50, h: a?.w ?? 50 }; return { ...m, ...f }; });
    const minX = Math.min(...ext.map((m) => m.dx - m.w / 2)), maxX = Math.max(...ext.map((m) => m.dx + m.w / 2));
    const minY = Math.min(...ext.map((m) => m.dy - m.h / 2)), maxY = Math.max(...ext.map((m) => m.dy + m.h / 2));
    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
    for (const m of members) { m.dx = Math.round(m.dx - ox); m.dy = Math.round(m.dy - oy); }
    const [rawName, ...rest] = d.text.split(/\s+[—–-]\s+/);
    const name = rawName.trim().slice(0, 60);
    const description = rest.join(' — ').trim() || d.text;
    const memberAssets = members.map((m) => byId.get(m.assetId)).filter(Boolean) as Asset[];
    const lex = lexiconVector(`${name} ${description}`);
    const vector = AXES.map((_, i) => Math.max(lex[i], ...memberAssets.map((a) => a.vector[i] * 0.8)));
    return [{
      id: `learned_${slug(name)}_${Math.random().toString(36).slice(2, 6)}`,
      name, description, category: 'arrangement',
      tags: [...new Set(memberAssets.flatMap((a) => a.tags))].slice(0, 12),
      vector, w: Math.round(maxX - minX), h: Math.round(maxY - minY), shape: 'rect' as const,
      color: '#cccccc', placement: nearWall ? 'wall' as const : 'center' as const, source: 'learned' as const,
      composite: { members },
    }];
  });
}

// ---------------------------------------------------------------- tool_4 compose: r28* + r2 → r2_2
const signature = (a: Asset) => (a.composite?.members.map((m) => m.assetId).sort().join('|') ?? a.id);
export function mergeLibrary(library: Library, records: Asset[]): { library: Library; added: string[] } {
  const existing = new Set(library.assets.filter((a) => a.composite).map(signature));
  const fresh = records.filter((r) => !existing.has(signature(r)));
  if (!fresh.length) return { library, added: [] };
  return { library: { version: library.version + 1, assets: [...library.assets, ...fresh] }, added: fresh.map((r) => r.id) };
}

// ---------------------------------------------------------------- model_7 evaluate: r29 + r2_2 + r11 → r30*
export async function judgeAssets(thumbs: Record<string, string>, library: Library, scene: Scene): Promise<Judgement[]> {
  const ids = Object.keys(thumbs);
  if (!ids.length) return [];
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const items = ids.map((id) => { const a = byId.get(id)!; return { assetId: id, name: a.name, description: a.description, members: a.composite?.members.map((m) => byId.get(m.assetId)?.name), svg: thumbs[id] }; });
  return callModelJson({
    role: 'model_7',
    system: 'You are a strict quality reviewer for a furniture-arrangement catalogue. You read top-down SVG renderings. Output only JSON.',
    prompt: `These arrangements were learned from a scene made for: """${scene.request}"""\n\nEach has a name, description and a top-down SVG rendering (shapes are furniture footprints).\n${JSON.stringify(items, null, 1)}\n\nJudge each one: is the rendering a sensible, reusable arrangement that matches its name and description (no overlapping pieces, plausible spacing, coherent purpose)? Verdict is exactly one of "accept", "revise", "reject".\nReturn {"judgements": [{"assetId": string, "verdict": "accept"|"revise"|"reject", "reason": string}]}.`,
  }, (v) => {
    const out = asArray(asObject(v).judgements).map((x) => {
      const o = asObject(x);
      const verdict = asString(o.verdict).toLowerCase() as Verdict;
      if (!['accept', 'revise', 'reject'].includes(verdict)) throw new Error(`bad verdict ${verdict}`);
      return { assetId: asString(o.assetId), verdict, reason: String(o.reason ?? '') };
    }).filter((j) => ids.includes(j.assetId));
    if (out.length !== ids.length) throw new Error('a verdict is required for every asset');
    return out;
  });
}

// ---------------------------------------------------------------- tool_5 evaluate: r30* → r31*
const VERDICT_SCORE: Record<Verdict, number> = { accept: 1, revise: 0.5, reject: 0 };
export function scoreVerdicts(judgements: Judgement[], library: Library): AssetScore[] {
  const byId = new Map(library.assets.map((a) => [a.id, a]));
  const scores = new Map<string, number[]>();
  const push = (id: string, s: number) => scores.set(id, [...(scores.get(id) ?? []), s]);
  for (const j of judgements) {
    const s = VERDICT_SCORE[j.verdict];
    push(j.assetId, s);
    for (const m of byId.get(j.assetId)?.composite?.members ?? []) push(m.assetId, s); // credit the parts too
  }
  return [...scores].map(([assetId, s]) => ({ assetId, score: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 1000) / 1000 }));
}

// ---------------------------------------------------------------- tool_5 train: r31* + r3 → r3_2
export function trainReliability(r: Reliability, scores: AssetScore[], sceneId: string): Reliability {
  if (!scores.length) return r;
  const weights = { ...r.weights };
  const updates: Reliability['history'][number]['updates'] = {};
  for (const { assetId, score } of scores) {
    const from = reliabilityOf(r, assetId);
    const to = Math.round((from + r.learningRate * (score - from)) * 1000) / 1000;
    weights[assetId] = to;
    updates[assetId] = { from, to, score };
  }
  return { ...r, version: r.version + 1, weights, history: [...r.history, { at: new Date().toISOString(), sceneId, updates }] };
}

// ---------------------------------------------------------------- whole process
export async function runProcess3(input: { scene: Scene; layout: Layout; view: SceneView }, library: Library, reliability: Reliability, emit: Emit) {
  const r22 = await emit.step('r22', 'tool_4 compose', async () => snapshotScene(input.scene, input.layout, input.view));
  const r23 = await emit.step('r23', 'tool_4 extract', async () => objectTable(r22));
  const r24 = await emit.step('r24', 'tool_4 assign', async () => assignRelations(r23));
  const r25 = await emit.step('r25', 'tool_4 extract', async () => extractGroups(r24));
  const r26 = await emit.step('r26', 'model_6 expand', () => expandGroups(r25, r22.scene));
  const r27 = await emit.step('r27', 'model_6 extract', () => describeAssets(r26));
  const r28 = await emit.step('r28', 'tool_4 translate', async () => toAssetRecords(r27, r26, library, r22.scene));
  const { library: r2_2, added } = await emit.step('r2_2', 'tool_4 compose', async () => mergeLibrary(library, r28));
  const r29 = await emit.step('r29', 'tool_2 translate', async () => renderThumbnails(r2_2, added));
  for (const a of r2_2.assets) if (r29[a.id]) a.thumbnail = r29[a.id];
  const r30 = await emit.step('r30', 'model_7 evaluate', () => judgeAssets(r29, r2_2, r22.scene));
  const r31 = await emit.step('r31', 'tool_5 evaluate', async () => scoreVerdicts(r30, r2_2));
  const r3_2 = await emit.step('r3_2', 'tool_5 train', async () => trainReliability(reliability, r31, r22.scene.id));
  return { library: r2_2, reliability: r3_2, added, judgements: r30 };
}
