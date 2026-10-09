import type { Room, SceneObject, SceneRelation } from './types';
import { angleDiff, gap, isFloorCover, nearestWall, rotationToward, windowCentres } from './geometry';

/** Pairwise and object-room spatial relations of a layout. */
export function computeRelations(objects: SceneObject[], room: Room): SceneRelation[] {
  const rel: SceneRelation[] = [];
  for (const o of objects) {
    const nw = nearestWall(o, room);
    if (nw.dist < 0.12) rel.push({ subject: o.id, relation: 'against_wall', object: `${nw.wall}_wall` });
    const ws = windowCentres(room);
    if (ws.some((w) => Math.hypot(w.x - o.x, w.z - o.z) < 1.5)) rel.push({ subject: o.id, relation: 'near_window', object: 'window' });
    for (const p of objects) {
      if (p.id === o.id) continue;
      if (isFloorCover(p) && !isFloorCover(o) && gap(o, p) === 0) rel.push({ subject: o.id, relation: 'on', object: p.id });
      if (isFloorCover(o) || isFloorCover(p)) continue;
      if (o.id < p.id && gap(o, p) < 0.4) rel.push({ subject: o.id, relation: 'near', object: p.id });
      if (Math.hypot(o.x - p.x, o.z - p.z) < 3 && angleDiff(o.rotation, rotationToward(o.x, o.z, p.x, p.z)) < 25) {
        rel.push({ subject: o.id, relation: 'facing', object: p.id });
      }
    }
  }
  return rel;
}
