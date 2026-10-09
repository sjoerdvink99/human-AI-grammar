// tool_4: spatial context extraction and constraint grounding pipeline.
import type {
  GraphRep, InteractionLog, MemoryScene, ObjectFeatureRow, PreferenceMemory, RetrievalTrace, SceneGraph,
  SessionPayload, SpatialConstraint,
} from '../shared/types';
import { catalogEntry, normalizeType } from '../shared/catalog';
import { doorCentre, gap, isFloorCover, nearestWall, round2, windowCentres } from '../shared/geometry';
import { computeRelations } from '../shared/relations';
import { affordanceKey } from './rerankers';

/** tool_4 compose: final scene + interaction log → session payload. */
export function composeSessionPayload(sessionId: string, request: string, scene: SceneGraph, interactionLog: InteractionLog): SessionPayload {
  return { sessionId, request, scene: { ...scene, relations: computeRelations(scene.objects, scene.room) }, interactionLog };
}

/** tool_4 extract: per-object properties. */
export function extractObjectFeatures(p: SessionPayload): ObjectFeatureRow[] {
  const { room, objects } = p.scene;
  const edited = new Set<string>();
  const added = new Set<string>();
  for (const e of p.interactionLog.entries) {
    for (const t of e.subtasks) if ('id' in t) edited.add(t.id);
    for (const r of e.results) { const m = r.match(/^✓ added (\S+)/); if (m) added.add(m[1]); }
  }
  const ws = windowCentres(room);
  const dc = doorCentre(room);
  return objects.map((o) => {
    const nw = nearestWall(o, room);
    return {
      id: o.id, type: o.type, functions: catalogEntry(o.type).functions.join('/'),
      w: o.w, d: o.d, h: o.h, x: o.x, z: o.z, rotation: o.rotation,
      nearestWall: nw.wall, wallDist: round2(nw.dist),
      windowDist: ws.length ? round2(Math.min(...ws.map((w) => Math.hypot(w.x - o.x, w.z - o.z)))) : -1,
      doorDist: round2(Math.hypot(dc.x - o.x, dc.z - o.z)),
      editedByUser: edited.has(o.id), addedByUser: added.has(o.id),
    };
  });
}

const ZONE_NAMES: Record<string, string> = {
  sleeping: 'sleeping area', work: 'work area', reading: 'reading corner', lounging: 'lounge area', dining: 'dining area',
  cooking: 'kitchen area', storage: 'storage', media: 'lounge area', music: 'music corner', play: 'play area', decor: 'decor', lighting: 'decor', misc: 'other',
};

/** tool_4 assign: functional object groups (zones) from function tags and proximity. */
export function assignFunctionalZones(features: ObjectFeatureRow[], scene: SceneGraph): GraphRep {
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  const fn = new Map<string, string>();
  // pick, for each object, the function its neighbours share most
  for (const f of features) {
    const o = byId.get(f.id)!;
    const options = catalogEntry(f.type).functions;
    const neighbours = scene.objects.filter((p) => p.id !== o.id && !isFloorCover(p) && gap(o, p) < 1.2);
    const tally = options.map((opt) => neighbours.filter((n) => catalogEntry(n.type).functions.includes(opt)).length);
    const best = options[tally.indexOf(Math.max(...tally))] ?? 'misc';
    fn.set(f.id, best);
  }
  // decor, lighting and rugs join the zone of their nearest functional neighbour
  for (const f of features) {
    if (!['decor', 'lighting'].includes(fn.get(f.id)!)) continue;
    const o = byId.get(f.id)!;
    const others = scene.objects.filter((p) => p.id !== o.id && !['decor', 'lighting'].includes(fn.get(p.id)!));
    const near = others.sort((a, b) => gap(o, a) - gap(o, b))[0];
    if (near && gap(o, near) < 1.0) fn.set(f.id, fn.get(near.id)!);
  }
  // single-linkage clustering of same-function objects
  const zoneOf = new Map<string, number>();
  let zones = 0;
  for (const o of scene.objects) {
    if (zoneOf.has(o.id)) continue;
    const z = zones++;
    const stack = [o];
    zoneOf.set(o.id, z);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const p of scene.objects) {
        if (zoneOf.has(p.id) || fn.get(p.id) !== fn.get(cur.id)) continue;
        if (gap(cur, p) < 2.0) { zoneOf.set(p.id, z); stack.push(p); }
      }
    }
  }
  const graph: GraphRep = { nodes: [{ id: 'room', kind: 'room', label: scene.room.roomType.replace(/_/g, ' ') }], edges: [] };
  const nameCount = new Map<string, number>();
  for (let z = 0; z < zones; z++) {
    const members = scene.objects.filter((o) => zoneOf.get(o.id) === z);
    const base = ZONE_NAMES[fn.get(members[0].id)!] ?? 'zone';
    const n = (nameCount.get(base) ?? 0) + 1;
    nameCount.set(base, n);
    const id = `zone_${z + 1}`;
    graph.nodes.push({
      id, kind: 'zone', label: n > 1 ? `${base} ${n}` : base,
      x: round2(members.reduce((s, m) => s + m.x, 0) / members.length), z: round2(members.reduce((s, m) => s + m.z, 0) / members.length),
    });
    graph.edges.push({ source: 'room', target: id, relation: 'contains' });
    for (const m of members) {
      graph.nodes.push({ id: m.id, kind: 'object', label: m.label, x: m.x, z: m.z });
      graph.edges.push({ source: id, target: m.id, relation: 'contains' });
    }
  }
  return graph;
}

/** tool_4 extract: local spatial relations and global room connectivity. */
export function extractGeometricContext(zones: GraphRep, scene: SceneGraph): GraphRep {
  const nodes = [...zones.nodes, { id: 'door', kind: 'object' as const, label: 'door', ...doorCentre(scene.room) }];
  const edges: GraphRep['edges'] = computeRelations(scene.objects, scene.room).map((r) => ({ source: r.subject, target: r.object, relation: r.relation }));
  const zoneNodes = zones.nodes.filter((n) => n.kind === 'zone');
  const dc = doorCentre(scene.room);
  for (const a of zoneNodes) {
    for (const b of zoneNodes) {
      if (a.id >= b.id) continue;
      const d = Math.hypot(a.x! - b.x!, a.z! - b.z!);
      if (d < 2.8) edges.push({ source: a.id, target: b.id, relation: 'adjacent', value: round2(d) });
    }
    // connectivity: is the straight path from the door to the zone obstructed?
    const blockers = scene.objects.filter((o) => {
      if (isFloorCover(o) || zones.edges.some((e) => e.source === a.id && e.target === o.id)) return false;
      for (let t = 0.1; t < 0.9; t += 0.05) {
        const px = dc.x + (a.x! - dc.x) * t, pz = dc.z + (a.z! - dc.z) * t;
        if (Math.abs(px - o.x) < o.w / 2 + 0.2 && Math.abs(pz - o.z) < o.d / 2 + 0.2) return true;
      }
      return false;
    });
    edges.push({ source: 'door', target: a.id, relation: blockers.length ? `reachable_via_detour (blocked by ${blockers.map((b) => b.id).join(', ')})` : 'directly_reachable', value: round2(Math.hypot(a.x! - dc.x, a.z! - dc.z)) });
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------- grounding

/** Statement templates shared with model_6's prompt; tool_4 only accepts statements in these forms. */
export const AFFORDANCE_TEMPLATES = [
  'Place the <object> against a wall.',
  'Place the <object> near the <object>.',
  'Keep the <object> away from the <object>.',
  'Orient the <object> to face the <object>.',
  'Place the <object> near a window.',
  'Place the <object> in a corner.',
  'Place the <object> in the centre of the room.',
  'Keep the <object> away from the door.',
];

const PATTERNS: [RegExp, SpatialConstraint['kind'], boolean][] = [
  [/^place (?:the |a |an )?(.+?) against (?:a |the )?wall/i, 'against_wall', false],
  [/^place (?:the |a |an )?(.+?) near (?:a |the )?window/i, 'near_window', false],
  [/^place (?:the |a |an )?(.+?) in (?:a |the )?corner/i, 'in_corner', false],
  [/^place (?:the |a |an )?(.+?) in the cent(?:re|er)/i, 'centered', false],
  [/^keep (?:the |a |an )?(.+?) away from (?:the )?door/i, 'away_from_door', false],
  [/^place (?:the |a |an )?(.+?) (?:near|next to|beside) (?:the |a |an )?([a-z _-]+?)(?:[.,;]|$| because| so| to )/i, 'near', true],
  [/^keep (?:the |a |an )?(.+?) away from (?:the |a |an )?([a-z _-]+?)(?:[.,;]|$| because| so| to )/i, 'far_from', true],
  [/^orient (?:the |a |an )?(.+?) to face (?:the |a |an )?([a-z _-]+?)(?:[.,;]|$| because| so| to )/i, 'facing', true],
];

/** tool_4 translate: affordance statements → spatial constraints. Unparseable statements are reported, not stored. */
export function groundAffordances(statements: string[]): { constraints: SpatialConstraint[]; statements: string[]; rejected: string[] } {
  const constraints: SpatialConstraint[] = [];
  const kept: string[] = [];
  const rejected: string[] = [];
  for (const raw of statements) {
    const s = raw.trim();
    let c: SpatialConstraint | null = null;
    for (const [re, kind, binary] of PATTERNS) {
      const m = s.match(re);
      if (!m) continue;
      const subject = normalizeType(m[1]);
      const object = binary ? normalizeType(m[2]) : undefined;
      if (subject && (!binary || (object && object !== subject) || (object === subject && kind === 'near'))) {
        c = { kind, subject, ...(binary ? { object: object! } : {}), weight: 3, source: 'retrieved', statement: s };
      }
      break;
    }
    const dup = c && constraints.some((x) => x.kind === c!.kind && x.subject === c!.subject && x.object === c!.object);
    if (c && !dup) { constraints.push(c); kept.push(s); } else rejected.push(s);
  }
  return { constraints, statements: kept, rejected };
}

/** tool_4 compose: adds the session's scene and grounded preferences to memory → preference_memory_2. */
export function composePreferenceMemory(
  memory: PreferenceMemory, payload: SessionPayload, trace: RetrievalTrace, constraints: SpatialConstraint[],
): PreferenceMemory {
  const scene: MemoryScene = {
    id: payload.sessionId,
    request: payload.request,
    key: trace.queryEmbedding,
    room: payload.scene.room,
    objectTypes: payload.scene.objects.map((o) => o.type),
    createdAt: new Date().toISOString(),
    affordances: constraints.map((c, i) => ({
      id: `${payload.sessionId}_a${i + 1}`,
      sceneId: payload.sessionId,
      statement: c.statement!,
      constraint: c,
      key: affordanceKey(c.statement!, trace.queryEmbedding),
    })),
  };
  return { version: memory.version + 1, scenes: [...memory.scenes.filter((s) => s.id !== scene.id), scene] };
}
