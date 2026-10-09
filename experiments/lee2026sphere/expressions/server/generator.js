// [tool_1 generate] room constraints, [tool_3 compose] generation constraints, [tool_1 generate] scene graph.
import { CATALOG, CATEGORIES, violation, overlapArea, outOfBounds, constraintKey } from './catalog.js';
import { makeRng } from './policy.js';

const SYNONYMS = {
  bed: ['bed', 'double bed', 'king', 'queen bed'], nightstand: ['nightstand', 'bedside table', 'night stand'],
  wardrobe: ['wardrobe', 'closet', 'armoire'], dresser: ['dresser', 'chest of drawers'], desk: ['desk', 'workstation', 'work desk'],
  office_chair: ['office chair', 'desk chair'], bookshelf: ['bookshelf', 'bookcase', 'shelves', 'books'],
  sofa: ['sofa', 'couch', 'settee'], armchair: ['armchair', 'reading chair', 'lounge chair'], coffee_table: ['coffee table'],
  side_table: ['side table', 'end table'], tv_stand: ['tv', 'television', 'tv stand', 'movie', 'movies', 'films'], floor_lamp: ['lamp', 'floor lamp'],
  rug: ['rug', 'carpet'], dining_table: ['dining table', 'table for'], dining_chair: ['dining chair'], sideboard: ['sideboard', 'buffet'],
  kitchen_counter: ['kitchen', 'counter'], fridge: ['fridge', 'refrigerator'], piano: ['piano'], plant: ['plant', 'plants', 'greenery'],
  crib: ['crib', 'cot', 'baby'], toy_chest: ['toy', 'toys'], play_mat: ['play mat', 'play area', 'yoga mat'], treadmill: ['treadmill', 'gym'],
  mirror: ['mirror'],
};

export function mentionedCategories(request) {
  const r = ` ${request.toLowerCase()} `;
  const wanted = new Set(), unwanted = new Set();
  for (const [cat, words] of Object.entries(SYNONYMS)) {
    for (const w of words) {
      const re = new RegExp(`\\b(?:no|without|don't want(?: a| any)?)\\s+(?:\\w+\\s+)?${w}\\b`);
      if (re.test(r)) unwanted.add(cat);
      else if (new RegExp(`\\b${w}\\b`).test(r)) wanted.add(cat);
    }
  }
  for (const u of unwanted) wanted.delete(u);
  return { wanted: [...wanted], unwanted: [...unwanted] };
}

function parseRoomSize(request) {
  const m = request.match(/(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?/i);
  if (!m) return null;
  const w = Number(m[1]), d = Number(m[2]);
  if (w < 2 || d < 2 || w > 12 || d > 12) return null;
  return { width: w, depth: d };
}

/**
 * [tool_1 generate] request_1 + sampled_scenes_1* + sampled_affordances_1* -> room_constraints_1
 */
export function generateRoomConstraints(request, sampledScenes, sampledAffordances) {
  const lead = sampledScenes[0];
  const room = parseRoomSize(request) || {
    width: Math.max(...sampledScenes.map((s) => s.room.width)),
    depth: Math.max(...sampledScenes.map((s) => s.room.depth)),
  };
  const counts = {};
  for (const s of sampledScenes) for (const [c, n] of Object.entries(s.objects)) counts[c] = Math.max(counts[c] || 0, n);
  const { wanted, unwanted } = mentionedCategories(request);
  for (const c of wanted) counts[c] = Math.max(counts[c] || 0, 1);
  const people = request.match(/(?:for|seats?|seating)\s+(\d+)/i);
  if (people && counts.dining_table) counts.dining_chair = Math.min(10, Number(people[1]));
  for (const c of unwanted) delete counts[c];
  // Keep the room furnishable: trim object area to ~45% of the floor.
  const area = room.width * room.depth;
  const order = Object.keys(counts).sort((a, b) => (wanted.includes(b) - wanted.includes(a)) || (CATALOG[b].w * CATALOG[b].d - CATALOG[a].w * CATALOG[a].d));
  const objects = [];
  let used = 0;
  for (const c of order) {
    for (let i = 0; i < counts[c]; i++) {
      const a = CATALOG[c].floor ? 0 : CATALOG[c].w * CATALOG[c].d;
      if (used + a > area * 0.45 && !wanted.includes(c)) continue;
      used += a;
      objects.push({ id: `${c}_${i + 1}`, category: c });
    }
  }
  return {
    room_type: lead.tags.find((t) => ['bedroom', 'living_room', 'office', 'dining_room', 'kitchen', 'kids_room', 'studio'].includes(t)) || 'room',
    width: room.width, depth: room.depth,
    objects,
    requested: wanted, excluded: unwanted,
    affordance_keys: sampledAffordances.map((a) => a.key),
  };
}

/**
 * [tool_3 compose] room_constraints_1 + sampled_affordances_1* -> generation_constraints_1
 */
export function composeGenerationConstraints(roomConstraints, sampledAffordances) {
  const present = new Set(roomConstraints.objects.map((o) => o.category));
  const constraints = [];
  const seen = new Set();
  for (const a of sampledAffordances) {
    const c = a.constraint;
    if (!present.has(c.a) || (c.b && !present.has(c.b))) continue;
    seen.add(constraintKey(c));
    constraints.push({ ...c, key: a.key, weight: 1 + Math.max(0, a.total ?? 0.5), source: 'affordance' });
  }
  // Catalog defaults (low weight) so wall furniture is not left floating.
  for (const cat of present) {
    if (CATALOG[cat].wall && !seen.has(`against_wall:${cat}:`)) constraints.push({ type: 'against_wall', a: cat, weight: 0.5, source: 'default' });
  }
  return { room: { type: roomConstraints.room_type, width: roomConstraints.width, depth: roomConstraints.depth }, objects: roomConstraints.objects, constraints };
}

function makeObject(spec) {
  const cat = CATALOG[spec.category];
  return { id: spec.id, category: spec.category, w: cat.w, d: cat.d, x: 0, y: 0, rot: 0 };
}

function rotTowards(o, b) {
  const dx = b.x - o.x, dy = b.y - o.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 270 : 90;
  return dy > 0 ? 0 : 180;
}

function candidates(obj, room, placed, related, rng) {
  const out = [];
  const add = (x, y, rot) => out.push({ x, y, rot });
  for (let i = 0; i < 120; i++) {
    add(0.3 + rng() * (room.width - 0.6), 0.3 + rng() * (room.depth - 0.6), [0, 90, 180, 270][Math.floor(rng() * 4)]);
  }
  for (let i = 0; i < 40; i++) {
    const t = rng();
    add(t * room.width, obj.d / 2, 0);
    add(t * room.width, room.depth - obj.d / 2, 180);
    const u = rng();
    add(obj.d / 2, u * room.depth, 270);
    add(room.width - obj.d / 2, u * room.depth, 90);
  }
  for (const { c, other } of related) {
    for (let i = 0; i < 40; i++) {
      const ang = rng() * Math.PI * 2;
      const reach = c.type === 'facing'
        ? (c.params?.min ?? 0.8) + rng() * ((c.params?.max ?? 3) - (c.params?.min ?? 0.8))
        : Math.max(other.w, other.d) / 2 + Math.max(obj.w, obj.d) / 2 + rng() * ((c.params?.max ?? 0.6) + 0.2);
      const pos = { x: other.x + Math.cos(ang) * reach, y: other.y + Math.sin(ang) * reach };
      if (c.type === 'beside') {
        // same orientation, side by side along the other's width axis, backs aligned
        const t = (other.rot * Math.PI) / 180;
        const along = { x: Math.cos(t), y: Math.sin(t) };
        const back = { x: Math.sin(t), y: -Math.cos(t) };
        const side = rng() < 0.5 ? -1 : 1;
        const off = other.w / 2 + obj.w / 2 + 0.03 + rng() * 0.1;
        const shift = (other.d - obj.d) / 2;
        add(other.x + along.x * off * side + back.x * shift, other.y + along.y * off * side + back.y * shift, other.rot);
      } else if (c.type === 'under') {
        add(other.x + (rng() - 0.5) * 0.2, other.y + (rng() - 0.5) * 0.2, other.rot);
      } else {
        add(pos.x, pos.y, rotTowards(pos, other));
      }
    }
  }
  return out;
}

function costOf(obj, room, placed, constraints) {
  let cost = 10 * outOfBounds(obj, room);
  const floor = !!CATALOG[obj.category].floor;
  for (const p of placed) {
    if (floor !== !!CATALOG[p.category].floor) continue; // floor items only collide with floor items
    const ov = overlapArea(obj, p);
    if (ov > 0.005) cost += 20 + 200 * ov; // collisions are (near-)hard constraints
  }
  for (const c of constraints) {
    if (c.a === obj.category) {
      if (!c.b) { cost += c.weight * violation(c, obj, null, room); continue; }
      const bs = placed.filter((p) => p.category === c.b);
      if (bs.length) cost += c.weight * Math.min(...bs.map((b) => violation(c, obj, b, room)));
    } else if (c.b === obj.category) {
      for (const a of placed.filter((p) => p.category === c.a)) cost += 0.5 * c.weight * violation(c, a, obj, room);
    }
  }
  return cost;
}

/**
 * [tool_1 generate] generation_constraints_1 -> scene_graph_1 (nodes with poses, edges = constraint relations).
 */
export function generateSceneGraph(gen, seed = 'scene') {
  const rng = makeRng(seed);
  const room = gen.room;
  const objs = gen.objects.map(makeObject);
  // Placement order: an object is placed after the objects it relates to (its constraint targets) when possible,
  // larger objects first among those ready; floor coverings last.
  const area = (o) => o.w * o.d;
  const targetsOf = (o) => new Set(gen.constraints.filter((c) => c.a === o.category && c.b && c.b !== o.category).map((c) => c.b));
  const pending = [...objs];
  const ordered = [];
  while (pending.length) {
    const solid = pending.filter((o) => !CATALOG[o.category].floor);
    const pool = solid.length ? solid : pending;
    const placedCats = new Set(ordered.map((o) => o.category));
    const presentCats = new Set(objs.map((o) => o.category));
    const ready = pool.filter((o) => [...targetsOf(o)].every((b) => placedCats.has(b) || !presentCats.has(b)));
    const next = (ready.length ? ready : pool).reduce((m, o) => (area(o) > area(m) ? o : m));
    ordered.push(next);
    pending.splice(pending.indexOf(next), 1);
  }
  objs.splice(0, objs.length, ...ordered);
  const placed = [];
  for (const obj of objs) {
    const related = gen.constraints
      .filter((c) => c.a === obj.category && c.b)
      .flatMap((c) => placed.filter((p) => p.category === c.b).map((other) => ({ c, other })));
    let best = null;
    for (const cand of candidates(obj, room, placed, related, rng)) {
      const trial = { ...obj, ...cand };
      const cost = costOf(trial, room, placed, gen.constraints);
      if (!best || cost < best.cost) best = { cost, pose: cand };
    }
    Object.assign(obj, best.pose);
    obj.x = round2(obj.x); obj.y = round2(obj.y);
    placed.push(obj);
  }
  return toGraph(placed, gen.constraints, room);
}

export function toGraph(objects, constraints, room) {
  const edges = [];
  for (const c of constraints) {
    for (const a of objects.filter((o) => o.category === c.a)) {
      if (!c.b) { edges.push({ a: a.id, type: c.type, satisfied: violation(c, a, null, room) < 0.1, key: c.key }); continue; }
      const bs = objects.filter((o) => o.category === c.b);
      if (!bs.length) continue;
      const b = bs.reduce((m, o) => (violation(c, a, o, room) < violation(c, a, m, room) ? o : m));
      edges.push({ a: a.id, b: b.id, type: c.type, satisfied: violation(c, a, b, room) < 0.1, key: c.key });
    }
  }
  return { room, nodes: objects.map((o) => ({ ...o })), edges };
}

const round2 = (x) => Math.round(x * 100) / 100;
export { CATEGORIES };
