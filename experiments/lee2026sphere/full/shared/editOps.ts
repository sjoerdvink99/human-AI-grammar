// tool_2 execute: applies atomic edit_subtasks to the scene. Deterministic and validated.
import type { EditSubtask, SceneGraph, SceneObject } from './types';
import { catalogEntry, CATALOG_BY_TYPE, NAMED_COLORS, normalizeType } from './catalog';
import { clampInside, findFreeSpot, round2 } from './geometry';

export function nextObjectId(scene: SceneGraph, type: string): string {
  let i = 1;
  while (scene.objects.some((o) => o.id === `${type}_${i}`)) i++;
  return `${type}_${i}`;
}

export function makeObject(scene: SceneGraph, type: string): SceneObject {
  const c = catalogEntry(type);
  const id = nextObjectId(scene, type);
  return { id, type, label: id.replace(/_/g, ' '), x: 0, z: 0, rotation: 0, w: c.w, d: c.d, h: c.h, color: c.color };
}

function resolveColor(color: string): string | null {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  return NAMED_COLORS[c] ?? null;
}

/** Returns a new scene and a human-readable result line per subtask. Invalid subtasks are skipped. */
export function executeSubtasks(scene: SceneGraph, subtasks: EditSubtask[]): { scene: SceneGraph; results: string[] } {
  let s: SceneGraph = structuredClone(scene);
  const results: string[] = [];
  const find = (id: string) => s.objects.find((o) => o.id === id);
  const replace = (o: SceneObject) => {
    s.objects = s.objects.map((x) => (x.id === o.id ? o : x));
  };

  for (const t of subtasks) {
    switch (t.op) {
      case 'add': {
        const type = CATALOG_BY_TYPE.has(t.type) ? t.type : normalizeType(t.type);
        if (!type) { results.push(`✗ add: unknown object type "${t.type}"`); break; }
        let o = makeObject(s, type);
        if (t.color) { const c = resolveColor(t.color); if (c) o.color = c; }
        const anchor = t.near ? find(t.near) : undefined;
        const px = t.x ?? anchor?.x ?? s.room.width / 2;
        const pz = t.z ?? anchor?.z ?? s.room.depth / 2;
        o = t.x !== undefined && t.z !== undefined ? clampInside({ ...o, x: px, z: pz }, s.room) : findFreeSpot(o, s.objects, s.room, px, pz);
        s.objects.push(o);
        results.push(`✓ added ${o.id} at (${o.x}, ${o.z})`);
        break;
      }
      case 'remove': {
        if (!find(t.id)) { results.push(`✗ remove: no object ${t.id}`); break; }
        s.objects = s.objects.filter((o) => o.id !== t.id);
        s.relations = s.relations.filter((r) => r.subject !== t.id && r.object !== t.id);
        results.push(`✓ removed ${t.id}`);
        break;
      }
      case 'move': {
        const o = find(t.id);
        if (!o || !Number.isFinite(t.x) || !Number.isFinite(t.z)) { results.push(`✗ move: invalid target ${t.id}`); break; }
        const m = clampInside({ ...o, x: t.x, z: t.z }, s.room);
        replace(m);
        results.push(`✓ moved ${t.id} to (${m.x}, ${m.z})`);
        break;
      }
      case 'rotate': {
        const o = find(t.id);
        if (!o || !Number.isFinite(t.degrees)) { results.push(`✗ rotate: invalid target ${t.id}`); break; }
        const rot = (((t.absolute ? t.degrees : o.rotation + t.degrees) % 360) + 360) % 360;
        replace(clampInside({ ...o, rotation: round2(rot) }, s.room));
        results.push(`✓ rotated ${t.id} to ${round2(rot)}°`);
        break;
      }
      case 'resize': {
        const o = find(t.id);
        if (!o || !(t.factor > 0.2 && t.factor < 4)) { results.push(`✗ resize: invalid target or factor for ${t.id}`); break; }
        replace(clampInside({ ...o, w: round2(o.w * t.factor), d: round2(o.d * t.factor), h: round2(o.h * t.factor) }, s.room));
        results.push(`✓ resized ${t.id} ×${t.factor}`);
        break;
      }
      case 'recolor': {
        const o = find(t.id);
        const c = resolveColor(t.color);
        if (!o || !c) { results.push(`✗ recolor: invalid target or colour for ${t.id}`); break; }
        replace({ ...o, color: c });
        results.push(`✓ recoloured ${t.id} ${t.color}`);
        break;
      }
    }
  }
  return { scene: s, results };
}
