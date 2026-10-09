// [tool_2 translate] scene graph -> spatial scene, and [tool_2 execute] edit subtasks on the scene.
import { CATALOG, overlapArea, outOfBounds, bounds } from './catalog.js';

const label = (cat, n) => `${cat.replace(/_/g, ' ')} ${n}`;

/** [tool_2 translate] scene_graph_1 -> scene_1 */
export function sceneFromGraph(graph) {
  return {
    room: { ...graph.room },
    objects: graph.nodes.map((n) => ({
      id: n.id, category: n.category, label: label(n.category, n.id.split('_').pop()),
      x: n.x, y: n.y, w: n.w, d: n.d, rot: n.rot, color: CATALOG[n.category].color, floor: !!CATALOG[n.category].floor,
    })),
    relations: graph.edges,
  };
}

/** Compact textual view of the scene for model prompts. */
export function sceneSummary(scene) {
  return {
    room: { width_m: scene.room.width, depth_m: scene.room.depth, origin: 'top-left corner; x to the right (east), y downward (south)' },
    objects: scene.objects.map((o) => ({ id: o.id, category: o.category, x: o.x, y: o.y, w: o.w, d: o.d, rot: o.rot, faces: facingWord(o.rot) })),
  };
}
const facingWord = (rot) => ({ 0: 'south', 90: 'west', 180: 'north', 270: 'east' })[((rot % 360) + 360) % 360] || `${rot}deg`;

function clamp(o, room) {
  const B = bounds(o);
  if (B.x0 < 0) o.x -= B.x0; if (B.y0 < 0) o.y -= B.y0;
  if (B.x1 > room.width) o.x -= B.x1 - room.width; if (B.y1 > room.depth) o.y -= B.y1 - room.depth;
  o.x = Math.round(o.x * 100) / 100; o.y = Math.round(o.y * 100) / 100;
}

function overlapWith(o, objects) {
  return objects.filter((p) => p.id !== o.id && p.floor === o.floor).reduce((a, p) => a + overlapArea(o, p), 0);
}

/** Nudge an object to the nearest spot (within 1.5 m) where it does not collide. */
function settle(o, scene) {
  if (o.floor || overlapWith(o, scene.objects) < 0.01) return;
  const start = { x: o.x, y: o.y };
  let best = { cost: overlapWith(o, scene.objects), x: o.x, y: o.y };
  for (let r = 0.1; r <= 1.5; r += 0.1) {
    for (let k = 0; k < 16; k++) {
      const t = (k / 16) * Math.PI * 2;
      Object.assign(o, { x: start.x + Math.cos(t) * r, y: start.y + Math.sin(t) * r });
      const cost = overlapWith(o, scene.objects) + 5 * outOfBounds(o, scene.room) + 0.01 * r;
      if (cost < best.cost) best = { cost, x: o.x, y: o.y };
    }
    if (best.cost < 0.02) break;
  }
  Object.assign(o, { x: best.x, y: best.y });
  clamp(o, scene.room);
}

function nextId(scene, cat) {
  let n = 1;
  while (scene.objects.some((o) => o.id === `${cat}_${n}`)) n++;
  return `${cat}_${n}`;
}

/**
 * [tool_2 execute] edit_subtasks_1* applied to scene_1. Returns the updated scene and a per-subtask report.
 * Subtask: {op, object_id?, category?, x?, y?, dx?, dy?, rot?, drot?, scale?, other_id?}
 */
export function executeSubtasks(sceneIn, subtasks) {
  const scene = structuredClone(sceneIn);
  const report = [];
  for (const t of subtasks) {
    const o = t.object_id ? scene.objects.find((x) => x.id === t.object_id) : null;
    const fail = (message) => report.push({ subtask: t, ok: false, message });
    try {
      switch (t.op) {
        case 'move': {
          if (!o) { fail(`unknown object ${t.object_id}`); break; }
          if (isNum(t.x)) o.x = t.x; if (isNum(t.y)) o.y = t.y;
          if (isNum(t.dx)) o.x += t.dx; if (isNum(t.dy)) o.y += t.dy;
          if (isNum(t.rot)) o.rot = norm(t.rot);
          clamp(o, scene.room); settle(o, scene);
          report.push({ subtask: t, ok: true, message: `moved ${o.id} to (${o.x}, ${o.y})` });
          break;
        }
        case 'rotate': {
          if (!o) { fail(`unknown object ${t.object_id}`); break; }
          o.rot = norm(isNum(t.rot) ? t.rot : o.rot + (isNum(t.drot) ? t.drot : 90));
          clamp(o, scene.room); settle(o, scene);
          report.push({ subtask: t, ok: true, message: `rotated ${o.id} to ${o.rot}°` });
          break;
        }
        case 'add': {
          const cat = t.category;
          if (!CATALOG[cat]) { fail(`unknown category ${cat}`); break; }
          const id = nextId(scene, cat);
          const c = CATALOG[cat];
          const n = { id, category: cat, label: label(cat, id.split('_').pop()), x: isNum(t.x) ? t.x : scene.room.width / 2,
            y: isNum(t.y) ? t.y : scene.room.depth / 2, w: c.w, d: c.d, rot: norm(t.rot ?? 0), color: c.color, floor: !!c.floor };
          scene.objects.push(n); clamp(n, scene.room); settle(n, scene);
          report.push({ subtask: t, ok: true, message: `added ${id} at (${n.x}, ${n.y})` });
          break;
        }
        case 'remove': {
          if (!o) { fail(`unknown object ${t.object_id}`); break; }
          scene.objects = scene.objects.filter((x) => x.id !== o.id);
          report.push({ subtask: t, ok: true, message: `removed ${o.id}` });
          break;
        }
        case 'resize': {
          if (!o) { fail(`unknown object ${t.object_id}`); break; }
          const s = Math.min(2, Math.max(0.5, isNum(t.scale) ? t.scale : 1));
          o.w = round(o.w * s); o.d = round(o.d * s); clamp(o, scene.room); settle(o, scene);
          report.push({ subtask: t, ok: true, message: `resized ${o.id} ×${s}` });
          break;
        }
        case 'swap': {
          const p = scene.objects.find((x) => x.id === t.other_id);
          if (!o || !p) { fail('swap needs two existing objects'); break; }
          [o.x, o.y, p.x, p.y] = [p.x, p.y, o.x, o.y];
          clamp(o, scene.room); clamp(p, scene.room);
          report.push({ subtask: t, ok: true, message: `swapped ${o.id} and ${p.id}` });
          break;
        }
        default: fail(`unknown op ${t.op}`);
      }
    } catch (e) { fail(e.message); }
  }
  return { scene, report };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const norm = (r) => ((Math.round(r / 90) * 90) % 360 + 360) % 360;
const round = (x) => Math.round(x * 100) / 100;
