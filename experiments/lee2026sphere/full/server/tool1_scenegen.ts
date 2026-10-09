// tool_1: constraint-based 3D indoor scene generation engine.
import type {
  GenerationConstraints, MemoryAffordance, MemoryScene, Room, RoomConstraints, RetrievalTrace,
  SceneGraph, SceneObject, SpatialConstraint, Wall,
} from '../shared/types';
import { CATALOG, ROOM_KEYWORDS, ROOM_TEMPLATES, catalogEntry } from '../shared/catalog';
import {
  constraintPenalty, doorCentre, halfExtents, isFloorCover, overlapArea, round2, rotationFacingAwayFrom, rotationToward,
} from '../shared/geometry';
import { computeRelations } from '../shared/relations';
import { mulberry32 } from '../shared/rng';

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, pair: 2, couple: 2 };

/** Object types the request mentions, with counts, and the ones it excludes. */
export function parseRequestObjects(request: string): { mentioned: Map<string, number>; excluded: Set<string> } {
  const text = request.toLowerCase();
  const mentioned = new Map<string, number>();
  const excluded = new Set<string>();
  // longest aliases first so "coffee table" wins over "table"
  const names = CATALOG.flatMap((c) => [c.type.replace(/_/g, ' '), ...c.aliases].map((n) => ({ n, type: c.type })))
    .sort((a, b) => b.n.length - a.n.length);
  let rest = ` ${text.replace(/[^a-z0-9 ]/g, ' ')} `;
  for (const { n, type } of names) {
    const re = new RegExp(`(\\b(?:no|without|not)\\s+(?:a\\s+|any\\s+)?)?(?:\\b(\\d|a|an|one|two|three|four|five|six|pair of|couple of)\\s+)?\\b${n}(?:e?s)?\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      if (m[1]) excluded.add(type);
      else {
        const w = (m[2] ?? '').replace(/ of$/, '');
        const count = /^\d$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? 1;
        mentioned.set(type, Math.max(mentioned.get(type) ?? 0, Math.min(count, 8)));
      }
    }
    rest = rest.replace(new RegExp(`\\b${n}(?:e?s)?\\b`, 'g'), ' ');
  }
  return { mentioned, excluded };
}

/** tool_1 generate (first call): room size and layout limits from the request and the sampled scenes. */
export function generateRoomConstraints(request: string, sampledScenes: MemoryScene[]): RoomConstraints {
  const notes: string[] = [];
  let roomType = ROOM_KEYWORDS.find(([re]) => re.test(request))?.[1];
  if (!roomType && sampledScenes[0]) { roomType = sampledScenes[0].room.roomType; notes.push(`room type taken from retrieved scene ${sampledScenes[0].id}`); }
  if (!roomType) { roomType = 'living_room'; notes.push('no room type in request; defaulted to living room'); }
  const template = ROOM_TEMPLATES[roomType] ?? ROOM_TEMPLATES.living_room;

  let [width, depth] = template.size;
  const dims = request.match(/(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)/i);
  if (dims) { width = Number(dims[1]); depth = Number(dims[2]); notes.push('dimensions from request'); }
  else {
    const same = sampledScenes.find((s) => s.room.roomType === roomType);
    if (same) { width = same.room.width; depth = same.room.depth; notes.push(`dimensions from retrieved scene ${same.id}`); }
    if (/\b(small|tiny|compact|cosy|cozy)\b/i.test(request)) { width *= 0.85; depth *= 0.85; notes.push('scaled down for a small or cosy room'); }
    if (/\b(large|big|spacious|huge)\b/i.test(request)) { width *= 1.25; depth *= 1.25; notes.push('scaled up for a large room'); }
  }
  width = round2(Math.min(Math.max(width, 2.5), 10));
  depth = round2(Math.min(Math.max(depth, 2.5), 10));

  const windows: Room['windows'] = [{ wall: 'north', offset: round2(width / 2 - 0.7), width: 1.4 }];
  if (/\b(bright|sunny|light|windows)\b/i.test(request)) windows.push({ wall: 'east', offset: round2(depth / 2 - 0.6), width: 1.2 });
  const room: Room = { roomType, width, depth, height: 2.7, windows, door: { wall: 'south', offset: 0.3, width: 0.9 } };

  const { mentioned, excluded } = parseRequestObjects(request);
  const only = /\bonly\b|\bjust\b/i.test(request) && mentioned.size > 0;
  let objectTypes = only ? [] : template.objects.filter((t) => !excluded.has(t));
  for (const [type, count] of mentioned) {
    const have = objectTypes.filter((t) => t === type).length;
    for (let i = have; i < count; i++) objectTypes.push(type);
  }
  // objects present in every sampled scene of this room type are part of the user's habits
  const sameType = sampledScenes.filter((s) => s.room.roomType === roomType);
  if (!only && sameType.length) {
    const common = [...new Set(sameType[0].objectTypes)].filter((t) => sameType.every((s) => s.objectTypes.includes(t)) && !excluded.has(t));
    for (const t of common) if (!objectTypes.includes(t)) { objectTypes.push(t); notes.push(`added ${t} (in every retrieved scene)`); }
  }
  const area = width * depth;
  // keep the floor area plausible; drop template extras before anything the user asked for
  const footprint = () => objectTypes.reduce((s, t) => s + (catalogEntry(t).floorCover ? 0 : catalogEntry(t).w * catalogEntry(t).d), 0);
  while (footprint() > area * 0.5 && objectTypes.length > 1) {
    let i = objectTypes.length - 1;
    while (i > 0 && mentioned.has(objectTypes[i])) i--;
    const [removed] = objectTypes.splice(i, 1);
    notes.push(`dropped ${removed}: room too full`);
  }
  return { room, objectTypes, notes };
}

/** Builds the retrieval trace that tool_1 emits alongside the room constraints. */
export function buildRetrievalTrace(args: {
  sessionId: string; request: string; policyVersion: number; memoryVersion: number; queryEmbedding: number[];
  candidates: MemoryScene[]; sampledScenes: MemoryScene[]; affordanceQuery: number[]; pool: MemoryAffordance[]; sampledAffordances: MemoryAffordance[];
}): RetrievalTrace {
  return {
    sessionId: args.sessionId,
    request: args.request,
    policyVersion: args.policyVersion,
    memoryVersion: args.memoryVersion,
    queryEmbedding: args.queryEmbedding,
    scenes: { candidates: args.candidates.map((s) => ({ id: s.id, key: s.key })), chosen: args.sampledScenes.map((s) => s.id) },
    affordances: {
      query: args.affordanceQuery,
      candidates: args.pool.map((a) => ({ id: a.id, key: a.key, statement: a.statement, sceneId: a.sceneId })),
      chosen: args.sampledAffordances.map((a) => a.id),
    },
  };
}

// ---------------------------------------------------------------- layout solver

function layoutCost(o: SceneObject, placed: SceneObject[], gc: GenerationConstraints): number {
  let cost = 0;
  const all = [...placed.filter((p) => p.id !== o.id), o];
  for (const c of gc.constraints) if (c.subject === o.type) cost += c.weight * constraintPenalty(c, o, all, gc.room);
  // constraints where o is the object also matter (e.g. moving the bed away from its nightstands)
  for (const p of placed) {
    if (p.id === o.id) continue;
    for (const c of gc.constraints) if (c.subject === p.type && c.object === o.type) cost += 0.5 * c.weight * constraintPenalty(c, p, all, gc.room);
  }
  if (!isFloorCover(o)) {
    for (const p of placed) if (p.id !== o.id && !isFloorCover(p)) cost += 60 * overlapArea(o, p);
    // keep the doorway clear
    const dc = doorCentre(gc.room);
    const door: SceneObject = { ...o, id: '__door', x: dc.x, z: dc.z - 0.45, w: 1.0, d: 0.9, rotation: 0 };
    cost += 40 * overlapArea(o, door);
    // tall objects should not block windows
    if (o.h > 1.0) for (const w of gc.room.windows) {
      const win = { ...o, id: '__win', rotation: 0, ...(w.wall === 'north' || w.wall === 'south'
        ? { x: w.offset + w.width / 2, z: w.wall === 'north' ? 0.2 : gc.room.depth - 0.2, w: w.width, d: 0.4 }
        : { z: w.offset + w.width / 2, x: w.wall === 'west' ? 0.2 : gc.room.width - 0.2, w: 0.4, d: w.width }) };
      cost += 20 * overlapArea(o, win);
    }
  }
  return cost;
}

function candidatePose(o: SceneObject, placed: SceneObject[], gc: GenerationConstraints, rnd: () => number): SceneObject {
  const room = gc.room;
  const facing = gc.constraints.find((c) => c.kind === 'facing' && c.subject === o.type);
  const near = gc.constraints.find((c) => c.kind === 'near' && c.subject === o.type);
  const anchor = near ? placed.filter((p) => p.type === near.object) : [];
  const mode = rnd();
  let x: number, z: number, rotation: number;
  if (anchor.length && mode < 0.45) {
    const a = anchor[Math.floor(rnd() * anchor.length)];
    const ang = rnd() * Math.PI * 2;
    const r = (Math.max(a.w, a.d) + Math.max(o.w, o.d)) / 2 + rnd() * 0.3;
    x = a.x + Math.cos(ang) * r;
    z = a.z + Math.sin(ang) * r;
    rotation = Math.floor(rnd() * 4) * 90;
  } else if (mode < 0.8) {
    const wall = (['north', 'south', 'east', 'west'] as Wall[])[Math.floor(rnd() * 4)];
    rotation = rotationFacingAwayFrom(wall);
    const [hx, hz] = halfExtents({ ...o, rotation });
    if (wall === 'north' || wall === 'south') { x = hx + rnd() * (room.width - 2 * hx); z = wall === 'north' ? hz : room.depth - hz; }
    else { z = hz + rnd() * (room.depth - 2 * hz); x = wall === 'west' ? hx : room.width - hx; }
  } else {
    x = rnd() * room.width;
    z = rnd() * room.depth;
    rotation = Math.floor(rnd() * 4) * 90;
  }
  if (facing) {
    const ts = placed.filter((p) => p.type === facing.object);
    if (ts.length && rnd() < 0.7) {
      const t = ts.reduce((a, b) => (Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b));
      rotation = Math.round(rotationToward(x, z, t.x, t.z) / 15) * 15;
    }
  }
  const [hx, hz] = halfExtents({ ...o, rotation });
  return {
    ...o,
    rotation: rotation % 360,
    x: round2(Math.min(Math.max(x, hx), room.width - hx)),
    z: round2(Math.min(Math.max(z, hz), room.depth - hz)),
  };
}

/** Placement order: anchors that other objects refer to first, then larger objects, rugs last. */
function placementOrder(gc: GenerationConstraints): string[] {
  const referred = new Set(gc.constraints.map((c) => c.object).filter(Boolean) as string[]);
  return [...gc.objectTypes].sort((a, b) => {
    const ca = catalogEntry(a), cb = catalogEntry(b);
    if (!!ca.floorCover !== !!cb.floorCover) return ca.floorCover ? 1 : -1;
    const ra = referred.has(a) ? 1 : 0, rb = referred.has(b) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return cb.w * cb.d - ca.w * ca.d;
  });
}

/** tool_1 generate (second call): solves the generation constraints into a scene graph. */
export function generateSceneGraph(gc: GenerationConstraints): SceneGraph {
  const rnd = mulberry32(gc.seed);
  const counters = new Map<string, number>();
  const placed: SceneObject[] = [];
  for (const type of placementOrder(gc)) {
    const c = catalogEntry(type);
    const n = (counters.get(type) ?? 0) + 1;
    counters.set(type, n);
    const base: SceneObject = { id: `${type}_${n}`, type, label: `${type.replace(/_/g, ' ')} ${n}`, x: 0, z: 0, rotation: 0, w: c.w, d: c.d, h: c.h, color: c.color };
    let best = base, bestCost = Infinity;
    for (let i = 0; i < 500; i++) {
      const cand = candidatePose(base, placed, gc, rnd);
      const cost = layoutCost(cand, placed, gc);
      if (cost < bestCost) { best = cand; bestCost = cost; }
    }
    placed.push(best);
  }
  // refinement: re-place each object with the others fixed
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < placed.length; i++) {
      let best = placed[i], bestCost = layoutCost(placed[i], placed, gc);
      for (let k = 0; k < 250; k++) {
        const cand = candidatePose(placed[i], placed, gc, rnd);
        const cost = layoutCost(cand, placed, gc);
        if (cost < bestCost) { best = cand; bestCost = cost; }
      }
      placed[i] = best;
    }
  }
  return { room: gc.room, objects: placed, relations: computeRelations(placed, gc.room) };
}

/** Summary of how well each constraint is met (shown in the UI next to the scene). */
export function constraintReport(scene: SceneGraph, constraints: SpatialConstraint[]) {
  return constraints.map((c) => {
    const subjects = scene.objects.filter((o) => o.type === c.subject);
    const penalty = subjects.length ? Math.max(...subjects.map((s) => constraintPenalty(c, s, scene.objects, scene.room))) : null;
    return { ...c, satisfied: penalty === null ? null : penalty < 0.15, penalty: penalty === null ? null : round2(penalty) };
  });
}
