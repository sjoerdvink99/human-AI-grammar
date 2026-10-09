import type { Room, SceneObject, SpatialConstraint, Wall } from './types';
import { catalogEntry } from './catalog';

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Axis-aligned footprint half extents of a (possibly rotated) object. */
export function halfExtents(o: Pick<SceneObject, 'w' | 'd' | 'rotation'>): [number, number] {
  const r = (o.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return [(o.w * c + o.d * s) / 2, (o.w * s + o.d * c) / 2];
}

export function overlapArea(a: SceneObject, b: SceneObject): number {
  const [ahx, ahz] = halfExtents(a);
  const [bhx, bhz] = halfExtents(b);
  const ox = Math.min(a.x + ahx, b.x + bhx) - Math.max(a.x - ahx, b.x - bhx);
  const oz = Math.min(a.z + ahz, b.z + bhz) - Math.max(a.z - ahz, b.z - bhz);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

export function isFloorCover(o: SceneObject) {
  return !!catalogEntry(o.type).floorCover;
}

/** Edge-to-edge gap between two footprints (0 when touching or overlapping). */
export function gap(a: SceneObject, b: SceneObject): number {
  const [ahx, ahz] = halfExtents(a);
  const [bhx, bhz] = halfExtents(b);
  const dx = Math.max(0, Math.abs(a.x - b.x) - ahx - bhx);
  const dz = Math.max(0, Math.abs(a.z - b.z) - ahz - bhz);
  return Math.hypot(dx, dz);
}

export function wallDistances(o: SceneObject, room: Room): Record<Wall, number> {
  const [hx, hz] = halfExtents(o);
  return {
    north: o.z - hz,
    south: room.depth - (o.z + hz),
    west: o.x - hx,
    east: room.width - (o.x + hx),
  };
}

export function nearestWall(o: SceneObject, room: Room): { wall: Wall; dist: number } {
  const d = wallDistances(o, room);
  const wall = (Object.keys(d) as Wall[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
  return { wall, dist: d[wall] };
}

/** Rotation (deg) so that the object's front faces away from the given wall, into the room. */
export function rotationFacingAwayFrom(wall: Wall): number {
  return { north: 0, south: 180, west: 90, east: 270 }[wall];
}

/** Rotation (deg) so that an object at (x,z) faces the point (tx,tz). 0 = facing +z. */
export function rotationToward(x: number, z: number, tx: number, tz: number): number {
  const a = (Math.atan2(tx - x, tz - z) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

export function windowCentres(room: Room): { x: number; z: number }[] {
  return room.windows.map((w) => wallPoint(room, w.wall, w.offset + w.width / 2));
}

export function doorCentre(room: Room) {
  return wallPoint(room, room.door.wall, room.door.offset + room.door.width / 2);
}

export function wallPoint(room: Room, wall: Wall, offset: number): { x: number; z: number } {
  switch (wall) {
    case 'north': return { x: offset, z: 0 };
    case 'south': return { x: offset, z: room.depth };
    case 'west': return { x: 0, z: offset };
    case 'east': return { x: room.width, z: offset };
  }
}

export function insideRoom(o: SceneObject, room: Room): boolean {
  const d = wallDistances(o, room);
  return d.north >= -0.01 && d.south >= -0.01 && d.east >= -0.01 && d.west >= -0.01;
}

export function clampInside(o: SceneObject, room: Room): SceneObject {
  const [hx, hz] = halfExtents(o);
  return {
    ...o,
    x: round2(Math.min(Math.max(o.x, hx), room.width - hx)),
    z: round2(Math.min(Math.max(o.z, hz), room.depth - hz)),
  };
}

/** Penalty (0 = satisfied) for one spatial constraint on one subject object. */
export function constraintPenalty(
  c: SpatialConstraint,
  subj: SceneObject,
  objects: SceneObject[],
  room: Room,
): number {
  const others = (type?: string) => objects.filter((o) => o.id !== subj.id && (!type || o.type === type));
  switch (c.kind) {
    case 'against_wall': {
      const { dist } = nearestWall(subj, room);
      return Math.max(0, dist - 0.05);
    }
    case 'in_corner': {
      const d = Object.values(wallDistances(subj, room)).sort((a, b) => a - b);
      return Math.max(0, d[0] - 0.1) + Math.max(0, d[1] - 0.1);
    }
    case 'centered':
      return Math.hypot(subj.x - room.width / 2, subj.z - room.depth / 2) * 0.5;
    case 'near_window': {
      const ws = windowCentres(room);
      if (!ws.length) return 0;
      return Math.max(0, Math.min(...ws.map((w) => Math.hypot(w.x - subj.x, w.z - subj.z))) - 1.2);
    }
    case 'away_from_door': {
      const dc = doorCentre(room);
      return Math.max(0, 1.8 - Math.hypot(dc.x - subj.x, dc.z - subj.z));
    }
    case 'near': {
      const os = others(c.object);
      if (!os.length) return 0;
      return Math.max(0, Math.min(...os.map((o) => gap(subj, o))) - 0.25);
    }
    case 'far_from': {
      const os = others(c.object);
      if (!os.length) return 0;
      return Math.max(0, 1.5 - Math.min(...os.map((o) => gap(subj, o))));
    }
    case 'facing': {
      const os = others(c.object);
      if (!os.length) return 0;
      const t = os.reduce((a, b) => (Math.hypot(a.x - subj.x, a.z - subj.z) < Math.hypot(b.x - subj.x, b.z - subj.z) ? a : b));
      return angleDiff(subj.rotation, rotationToward(subj.x, subj.z, t.x, t.z)) / 90;
    }
  }
}

/** Finds a free floor spot for a new object, preferring points close to (px,pz). */
export function findFreeSpot(
  obj: SceneObject,
  objects: SceneObject[],
  room: Room,
  px = room.width / 2,
  pz = room.depth / 2,
): SceneObject {
  let best: SceneObject | null = null;
  let bestScore = Infinity;
  const step = 0.1;
  for (let x = 0; x <= room.width; x += step) {
    for (let z = 0; z <= room.depth; z += step) {
      const cand = clampInside({ ...obj, x, z }, room);
      const ov = isFloorCover(cand) ? 0 : objects.filter((o) => o.id !== obj.id && !isFloorCover(o)).reduce((s, o) => s + overlapArea(cand, o), 0);
      const score = ov * 100 + Math.hypot(cand.x - px, cand.z - pz);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
  }
  return best ?? obj;
}
