// Shared vocabulary: object catalog, semantic axes for query_embedding, and spatial-constraint geometry.

export const CATALOG = {
  bed:            { w: 1.6, d: 2.1, color: '#8fa9d6', zone: 'sleeping', wall: true },
  nightstand:     { w: 0.5, d: 0.45, color: '#b7a07a', zone: 'sleeping', wall: true },
  wardrobe:       { w: 1.4, d: 0.6, color: '#a0815e', zone: 'storage', wall: true },
  dresser:        { w: 1.2, d: 0.5, color: '#b08d64', zone: 'storage', wall: true },
  desk:           { w: 1.4, d: 0.7, color: '#c4a36d', zone: 'work', wall: true },
  office_chair:   { w: 0.6, d: 0.6, color: '#555c66', zone: 'work' },
  bookshelf:      { w: 1.0, d: 0.35, color: '#9b7651', zone: 'reading', wall: true },
  sofa:           { w: 2.2, d: 0.9, color: '#7fb38a', zone: 'lounge', wall: true },
  armchair:       { w: 0.85, d: 0.85, color: '#93c4a0', zone: 'lounge' },
  coffee_table:   { w: 1.1, d: 0.6, color: '#c9b08a', zone: 'lounge' },
  side_table:     { w: 0.45, d: 0.45, color: '#c9b08a', zone: 'lounge' },
  tv_stand:       { w: 1.6, d: 0.45, color: '#4b4f58', zone: 'media', wall: true },
  floor_lamp:     { w: 0.35, d: 0.35, color: '#f1d36b', zone: 'reading' },
  rug:            { w: 2.0, d: 1.4, color: '#e6d5c3', zone: 'lounge', floor: true },
  dining_table:   { w: 1.6, d: 0.9, color: '#b5895a', zone: 'dining' },
  dining_chair:   { w: 0.45, d: 0.45, color: '#8a6a48', zone: 'dining' },
  sideboard:      { w: 1.6, d: 0.45, color: '#94704c', zone: 'dining', wall: true },
  kitchen_counter:{ w: 2.4, d: 0.6, color: '#c8c8c8', zone: 'cooking', wall: true },
  fridge:         { w: 0.7, d: 0.7, color: '#dfe6ea', zone: 'cooking', wall: true },
  piano:          { w: 1.5, d: 0.6, color: '#2d2d2d', zone: 'music', wall: true },
  plant:          { w: 0.4, d: 0.4, color: '#5fae5a', zone: 'decor' },
  crib:           { w: 1.3, d: 0.7, color: '#f0b8c0', zone: 'sleeping', wall: true },
  toy_chest:      { w: 0.9, d: 0.5, color: '#f2a65a', zone: 'play', wall: true },
  play_mat:       { w: 1.6, d: 1.6, color: '#bfe3f0', zone: 'play', floor: true },
  treadmill:      { w: 0.8, d: 1.8, color: '#6d6d6d', zone: 'exercise' },
  mirror:         { w: 0.8, d: 0.1, color: '#cfe8f5', zone: 'decor', wall: true },
};
export const CATEGORIES = Object.keys(CATALOG);

// Semantic axes of the query_embedding vector (model_3 output) and scene vectors.
export const AXES = [
  'bedroom', 'living_room', 'office', 'dining_room', 'kitchen', 'kids_room', 'studio',
  'sleep', 'work', 'read', 'watch_tv', 'entertain', 'eat', 'cook', 'music', 'play', 'exercise', 'storage', 'relax',
  'minimal', 'cozy', 'modern', 'traditional', 'small', 'large',
];

export const CONSTRAINT_TYPES = ['against_wall', 'near', 'facing', 'beside', 'around', 'centered', 'corner', 'clearance', 'under', 'far'];

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function tagsToVector(tags) {
  return AXES.map((ax) => (tags.includes(ax) ? 1 : 0));
}

// ---- geometry -------------------------------------------------------------
// Object pose: centre (x, y) in metres, room origin top-left, y grows downward.
// rot in degrees (0/90/180/270): the object's front faces +y when rot = 0, rotated clockwise.

export function footprint(o) {
  const r = ((o.rot % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  return { w: swap ? o.d : o.w, d: swap ? o.w : o.d };
}
export function bounds(o) {
  const f = footprint(o);
  return { x0: o.x - f.w / 2, x1: o.x + f.w / 2, y0: o.y - f.d / 2, y1: o.y + f.d / 2 };
}
export function frontVector(o) {
  const t = (o.rot * Math.PI) / 180;
  return { x: -Math.sin(t), y: Math.cos(t) };
}
export function overlapArea(a, b) {
  const A = bounds(a), B = bounds(b);
  const w = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
  const h = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
/** Gap between the two rectangles (0 if touching/overlapping). */
export function gap(a, b) {
  const A = bounds(a), B = bounds(b);
  const dx = Math.max(0, Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1));
  const dy = Math.max(0, Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1));
  return Math.hypot(dx, dy);
}
export function wallDistance(o, room) {
  const B = bounds(o);
  return Math.min(B.x0, B.y0, room.width - B.x1, room.depth - B.y1);
}
/** Distance from the object's back side to the nearest wall it backs onto. */
export function backWallDistance(o, room) {
  const B = bounds(o);
  const f = frontVector(o);
  if (f.y > 0.5) return B.y0;               // back faces top wall
  if (f.y < -0.5) return room.depth - B.y1; // back faces bottom wall
  if (f.x > 0.5) return B.x0;               // back faces left wall
  return room.width - B.x1;
}
export function facingScore(a, b) {
  const f = frontVector(a);
  const vx = b.x - a.x, vy = b.y - a.y;
  const n = Math.hypot(vx, vy) || 1;
  return (f.x * vx + f.y * vy) / n; // 1 = directly facing
}
export function outOfBounds(o, room) {
  const B = bounds(o);
  return Math.max(0, -B.x0) + Math.max(0, -B.y0) + Math.max(0, B.x1 - room.width) + Math.max(0, B.y1 - room.depth);
}

/**
 * Violation cost of one constraint on concrete objects (0 = satisfied).
 * c = {type, a, b?, params?}; objA and objB are scene objects.
 */
export function violation(c, objA, objB, room) {
  const p = c.params || {};
  switch (c.type) {
    case 'against_wall': return Math.max(0, backWallDistance(objA, room) - 0.1);
    case 'centered': return Math.max(0, Math.hypot(objA.x - room.width / 2, objA.y - room.depth / 2) - (p.radius ?? 0.8));
    case 'corner': {
      const B = bounds(objA);
      const dx = Math.min(B.x0, room.width - B.x1), dy = Math.min(B.y0, room.depth - B.y1);
      return Math.max(0, dx - 0.15) + Math.max(0, dy - 0.15);
    }
    case 'clearance': {
      // free space in front of objA must be >= min (approximated by distance to front wall)
      const f = frontVector(objA), B = bounds(objA);
      let free;
      if (f.y > 0.5) free = room.depth - B.y1; else if (f.y < -0.5) free = B.y0;
      else if (f.x > 0.5) free = room.width - B.x1; else free = B.x0;
      return Math.max(0, (p.min ?? 0.8) - free);
    }
    default: break;
  }
  if (!objB) return 0;
  const g = gap(objA, objB);
  switch (c.type) {
    case 'near': return Math.max(0, g - (p.max ?? 0.6));
    case 'far': return Math.max(0, (p.min ?? 1.5) - g);
    case 'beside': {
      const fa = frontVector(objA), fb = frontVector(objB);
      const aligned = fa.x * fb.x + fa.y * fb.y > 0.9 ? 0 : 0.5;
      return Math.max(0, g - (p.max ?? 0.25)) + aligned;
    }
    case 'facing': {
      const dist = Math.hypot(objA.x - objB.x, objA.y - objB.y);
      return (1 - facingScore(objA, objB)) * 2 + Math.max(0, dist - (p.max ?? 3.5)) + Math.max(0, (p.min ?? 0) - dist);
    }
    case 'around': return Math.max(0, g - (p.max ?? 0.25)) + (1 - facingScore(objA, objB));
    case 'under': return Math.hypot(objA.x - objB.x, objA.y - objB.y) * 2;
    default: return 0;
  }
}

export function humanize(c) {
  const n = (s) => (s || '').replace(/_/g, ' ');
  const p = c.params || {};
  switch (c.type) {
    case 'against_wall': return `${n(c.a)} stands against a wall`;
    case 'centered': return `${n(c.a)} is near the centre of the room`;
    case 'corner': return `${n(c.a)} sits in a corner`;
    case 'clearance': return `${n(c.a)} has at least ${p.min ?? 0.8} m free in front`;
    case 'near': return `${n(c.a)} is within ${p.max ?? 0.6} m of the ${n(c.b)}`;
    case 'far': return `${n(c.a)} is at least ${p.min ?? 1.5} m from the ${n(c.b)}`;
    case 'beside': return `${n(c.a)} is beside the ${n(c.b)}`;
    case 'facing': return `${n(c.a)} faces the ${n(c.b)}`;
    case 'around': return `${n(c.a)}s are arranged around the ${n(c.b)}`;
    case 'under': return `${n(c.a)} lies under the ${n(c.b)}`;
    default: return `${c.type} ${n(c.a)} ${n(c.b)}`;
  }
}
export function constraintKey(c) {
  return [c.type, c.a, c.b || ''].join(':');
}
