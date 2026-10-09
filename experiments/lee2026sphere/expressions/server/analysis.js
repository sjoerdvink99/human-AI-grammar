// Deterministic [tool_4] steps of process 3: features, zones, geometric context, affordance -> constraint.
import { CATALOG, CATEGORIES, gap, facingScore, wallDistance, backWallDistance, overlapArea, bounds, violation, constraintKey } from './catalog.js';

const r2 = (x) => Math.round(x * 100) / 100;

/** [tool_4 extract] session_payload_1 -> object_features_1 (table) */
export function extractObjectFeatures(payload) {
  const { scene, interaction_log } = payload;
  const room = scene.room;
  const edits = {}, added = new Set(), removed = new Map();
  for (const ev of interaction_log.events.filter((e) => e.type === 'edit')) {
    for (const r of ev.report || []) {
      if (!r.ok) continue;
      const id = r.subtask.object_id;
      if (id) edits[id] = (edits[id] || 0) + 1;
      if (r.subtask.op === 'add') { const m = /added (\S+)/.exec(r.message); if (m) added.add(m[1]); }
      if (r.subtask.op === 'remove') removed.set(id, r.subtask);
    }
  }
  const rows = scene.objects.map((o) => {
    const B = bounds(o);
    return {
      id: o.id, category: o.category, x: o.x, y: o.y, rot: o.rot, w: o.w, d: o.d,
      wall_dist: r2(wallDistance(o, room)), against_wall: !o.floor && backWallDistance(o, room) < 0.15,
      corner: Math.min(B.x0, room.width - B.x1) < 0.2 && Math.min(B.y0, room.depth - B.y1) < 0.2,
      center_dist: r2(Math.hypot(o.x - room.width / 2, o.y - room.depth / 2)),
      edits: edits[o.id] || 0, status: added.has(o.id) ? 'added' : 'kept',
    };
  });
  for (const [id] of removed) {
    if (!rows.some((r) => r.id === id)) rows.push({ id, category: id.replace(/_\d+$/, ''), status: 'removed', edits: edits[id] || 0 });
  }
  return rows;
}

/** [tool_4 assign] object_features_1 -> functional_zones_1 (graph: zone nodes + adjacency edges) */
export function assignZones(features) {
  const present = features.filter((f) => f.status !== 'removed');
  const groups = {};
  for (const f of present) (groups[CATALOG[f.category]?.zone || 'misc'] ||= []).push(f);
  const zones = [];
  for (const [zone, members] of Object.entries(groups)) {
    // single-link clustering (2 m) so two separate seating areas become two zones
    const clusters = [];
    for (const m of members) {
      const hit = clusters.filter((c) => c.some((o) => Math.hypot(o.x - m.x, o.y - m.y) < 2.0));
      const merged = [m, ...hit.flat()];
      for (const h of hit) clusters.splice(clusters.indexOf(h), 1);
      clusters.push(merged);
    }
    clusters.forEach((c, i) => zones.push({
      id: `${zone}${clusters.length > 1 ? `_${i + 1}` : ''}`, name: zone, objects: c.map((o) => o.id),
      centroid: { x: r2(c.reduce((a, o) => a + o.x, 0) / c.length), y: r2(c.reduce((a, o) => a + o.y, 0) / c.length) },
    }));
  }
  const edges = [];
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const d = Math.hypot(zones[i].centroid.x - zones[j].centroid.x, zones[i].centroid.y - zones[j].centroid.y);
    if (d < 3) edges.push({ a: zones[i].id, b: zones[j].id, relation: 'adjacent', distance: r2(d) });
  }
  return { nodes: zones, edges };
}

/** [tool_4 extract] (scene in session_payload_1) + functional_zones_1 -> geometric_context_1 (graph) */
export function extractGeometricContext(payload, zones) {
  const { scene } = payload;
  const room = scene.room;
  const objs = scene.objects;
  const zoneOf = (id) => zones.nodes.find((z) => z.objects.includes(id))?.id;
  const nodes = objs.map((o) => {
    const B = bounds(o);
    const unary = [];
    if (!o.floor && backWallDistance(o, room) < 0.15) unary.push('against_wall');
    if (Math.min(B.x0, room.width - B.x1) < 0.2 && Math.min(B.y0, room.depth - B.y1) < 0.2) unary.push('corner');
    if (Math.hypot(o.x - room.width / 2, o.y - room.depth / 2) < 1.0) unary.push('centered');
    return { id: o.id, category: o.category, zone: zoneOf(o.id), x: o.x, y: o.y, rot: o.rot, relations: unary };
  });
  const edges = [];
  for (const a of objs) for (const b of objs) {
    if (a.id === b.id) continue;
    const g = gap(a, b), dist = Math.hypot(a.x - b.x, a.y - b.y);
    const rel = [];
    if (a.floor && !b.floor && overlapArea(a, b) > 0.3 * b.w * b.d) rel.push('under');
    if (a.floor || b.floor) { if (rel.length) edges.push({ a: a.id, b: b.id, relations: rel, gap: r2(g), distance: r2(dist) }); continue; }
    if (g < 0.6) rel.push('near');
    if (violation({ type: 'beside', a: a.category, b: b.category }, a, b, room) < 0.05) rel.push('beside');
    if (facingScore(a, b) > 0.85 && dist < 4.5) rel.push('facing');
    if (g < 0.3 && facingScore(a, b) > 0.7) rel.push('around');
    if (g > 1.5) rel.push('far');
    if (rel.length && (g < 1.5 || rel.includes('facing'))) edges.push({ a: a.id, b: b.id, relations: rel, gap: r2(g), distance: r2(dist) });
  }
  return { room: { width: room.width, depth: room.depth }, nodes, edges };
}

const REL_WORDS = [
  ['facing', /\b(fac(e|es|ing)|toward|towards|oriented to|looks? at|view of)\b/],
  ['beside', /\b(beside|next to|flank(s|ing|ed)?|alongside|either side)\b/],
  ['around', /\b(around|surround(s|ing)?|encircl)/],
  ['under', /\b(under|beneath|underneath|anchors?)\b/],
  ['against_wall', /\b(against|along|backs? (on|onto|to)) (the |a )?wall/],
  ['corner', /\bcorner\b/],
  ['centered', /\b(cent(er|re)(d)?|middle)\b/],
  ['clearance', /\b(clearance|free space|walkway|circulation|room to|open space)\b/],
  ['far', /\b(away from|apart from|separate[d]? from|distance from|far from)\b/],
  ['near', /\b(near|close to|within reach|adjacent|by the|next|reach)\b/],
];

function mentionedObjects(text, scene) {
  const t = text.toLowerCase();
  const found = [];
  for (const o of scene.objects) {
    const idx = t.indexOf(o.id.toLowerCase());
    if (idx >= 0) found.push({ idx, cat: o.category, id: o.id });
  }
  for (const c of CATEGORIES) {
    for (const form of [c.replace(/_/g, ' '), c]) {
      const idx = t.indexOf(form);
      if (idx >= 0 && !found.some((f) => f.cat === c)) found.push({ idx, cat: c });
    }
  }
  return found.sort((a, b) => a.idx - b.idx);
}

/**
 * [tool_4 translate] affordances_1* (language) -> spatial_constraints_1* (records), grounded in the geometric context
 * so parameters are measured from the final layout rather than guessed.
 */
export function affordancesToConstraints(affordances, payload, geometric) {
  const { scene } = payload;
  const room = scene.room;
  const out = [];
  for (const text of affordances) {
    const t = text.toLowerCase();
    const type = REL_WORDS.find(([, re]) => re.test(t))?.[0];
    const objs = mentionedObjects(text, scene);
    if (!type || !objs.length) { out.push({ text, parsed: false }); continue; }
    const unary = ['against_wall', 'corner', 'centered', 'clearance'].includes(type);
    const a = objs[0].cat, b = unary ? undefined : objs.find((o) => o.cat !== a)?.cat;
    if (!unary && !b) { out.push({ text, parsed: false }); continue; }
    const c = { type, a, ...(b ? { b } : {}) };
    // measure on the actual layout
    const as = scene.objects.filter((o) => o.category === a);
    const bs = b ? scene.objects.filter((o) => o.category === b) : [null];
    let best = null;
    for (const oa of as) for (const ob of bs) {
      const v = violation(c, oa, ob, room);
      if (!best || v < best.v) best = { v, oa, ob };
    }
    const params = {};
    if (best?.ob) {
      const g = gap(best.oa, best.ob), d = Math.hypot(best.oa.x - best.ob.x, best.oa.y - best.ob.y);
      if (type === 'near' || type === 'beside' || type === 'around') params.max = r2(Math.max(0.25, g + 0.2));
      if (type === 'far') params.min = r2(Math.max(0.5, g - 0.2));
      if (type === 'facing') params.max = r2(d + 0.5);
    }
    if (type === 'clearance') params.min = 0.8;
    if (type === 'centered') params.radius = 1.0;
    const full = { ...c, ...(Object.keys(params).length ? { params } : {}) };
    const observed = best ? violation(full, best.oa, best.ob, room) < 0.1 : false;
    const hasEdge = !best?.ob || geometric.edges.some((e) => e.a === best.oa.id && e.b === best.ob.id);
    out.push({ ...full, key: constraintKey(full), text, parsed: true, observed, grounded_edge: hasEdge });
  }
  return out;
}
