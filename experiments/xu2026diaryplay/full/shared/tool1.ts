/**
 * tool_1 — greedy object-placement and path-finding algorithms (deterministic).
 * Implements P1.6 [tool_1 execute]: layout_1 + room_labels_2 + objects_1 -> environment_1,
 * and the path-finding used by tool_2 at runtime.
 */
import type { Environment, GameObject, Layout, Point, RoomLabels } from './types';

const key = (p: Point) => `${p.x},${p.y}`;
const DIRS: Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

export function isFloor(env: Pick<Environment, 'rooms' | 'doors'>, p: Point): boolean {
  if (env.doors.some((d) => d.x === p.x && d.y === p.y)) return true;
  return env.rooms.some((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
}

export function roomAt(env: Pick<Environment, 'rooms'>, p: Point) {
  return env.rooms.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
}

function objectTiles(o: Pick<GameObject, 'w' | 'h'>, pos: Point): Point[] {
  const t: Point[] = [];
  for (let dx = 0; dx < o.w; dx++) for (let dy = 0; dy < o.h; dy++) t.push({ x: pos.x + dx, y: pos.y + dy });
  return t;
}

/** Set of tiles blocked by placed objects. */
export function blockedTiles(objects: GameObject[], exceptId?: string): Set<string> {
  const s = new Set<string>();
  for (const o of objects) if (o.pos && o.id !== exceptId) for (const t of objectTiles(o, o.pos)) s.add(key(t));
  return s;
}

export function isWalkable(env: Environment, p: Point, blocked = blockedTiles(env.objects)): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < env.width && p.y < env.height && isFloor(env, p) && !blocked.has(key(p));
}

/** All free floor tiles form one connected region. */
function connected(env: Environment, blocked: Set<string>): boolean {
  const free: Point[] = [];
  for (let x = 0; x < env.width; x++) for (let y = 0; y < env.height; y++) {
    const p = { x, y };
    if (isWalkable(env, p, blocked)) free.push(p);
  }
  if (free.length === 0) return false;
  const seen = new Set([key(free[0])]);
  const q = [free[0]];
  while (q.length) {
    const c = q.shift()!;
    for (const d of DIRS) {
      const n = { x: c.x + d.x, y: c.y + d.y };
      if (!seen.has(key(n)) && isWalkable(env, n, blocked)) { seen.add(key(n)); q.push(n); }
    }
  }
  return seen.size === free.length;
}

/** Can the object at pos be placed without overlap, inside its room, keeping the floor connected? */
export function canPlace(env: Environment, obj: GameObject, pos: Point, others: GameObject[]): boolean {
  const room = env.rooms.find((r) => r.id === obj.roomId);
  if (!room) return false;
  const tiles = objectTiles(obj, pos);
  const blocked = blockedTiles(others, obj.id);
  for (const t of tiles) {
    if (t.x < room.x || t.y < room.y || t.x >= room.x + room.w || t.y >= room.y + room.h) return false;
    if (blocked.has(key(t))) return false;
    // keep tiles next to doors free so rooms stay reachable
    if (env.doors.some((d) => Math.abs(d.x - t.x) + Math.abs(d.y - t.y) <= 1)) return false;
  }
  for (const t of tiles) blocked.add(key(t));
  return connected(env, blocked);
}

/**
 * Greedy placement: biggest objects first; each takes the best-scoring free position
 * in its room (wall-hugging objects prefer walls, others prefer the room centre).
 */
export function placeObjects(layout: Layout, labels: RoomLabels, objects: GameObject[]): Environment {
  const env: Environment = {
    layoutId: layout.id,
    width: layout.width,
    height: layout.height,
    rooms: layout.rooms.map((r) => ({ ...r, label: labels[r.id] ?? r.id })),
    doors: layout.doors,
    objects: [],
  };
  const order = [...objects].sort((a, b) => b.w * b.h - a.w * a.h);
  const placed: GameObject[] = [];
  for (const o0 of order) {
    const o = { ...o0, pos: null as Point | null };
    const room = env.rooms.find((r) => r.id === o.roomId);
    if (room) {
      let best: { p: Point; s: number } | null = null;
      for (let x = room.x; x <= room.x + room.w - o.w; x++) for (let y = room.y; y <= room.y + room.h - o.h; y++) {
        const p = { x, y };
        const wallDist = Math.min(x - room.x, y - room.y, room.x + room.w - (x + o.w), room.y + room.h - (y + o.h));
        const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
        const centreDist = Math.abs(x + o.w / 2 - cx) + Math.abs(y + o.h / 2 - cy);
        // crowding: prefer spots away from already-placed objects
        const crowd = placed.filter((q) => q.pos && Math.abs(q.pos.x - x) + Math.abs(q.pos.y - y) < 3).length;
        const s = (o.againstWall ? wallDist * 10 + (y - room.y) * 0.1 : Math.abs(wallDist - 2) * 4 + centreDist * 0.3) + crowd * 6;
        if (best && s >= best.s) continue;
        if (canPlace(env, o, p, placed)) best = { p, s };
      }
      if (best) o.pos = best.p;
    }
    placed.push(o);
  }
  // keep the original order
  env.objects = objects.map((o) => placed.find((p) => p.id === o.id)!);
  return env;
}

/** BFS path from start to any tile adjacent to (or equal to) a goal tile set. */
export function findPath(env: Environment, start: Point, goals: Point[], blocked = blockedTiles(env.objects)): Point[] | null {
  const goalSet = new Set(goals.map(key));
  if (goalSet.has(key(start))) return [start];
  const prev = new Map<string, Point | null>([[key(start), null]]);
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    for (const d of DIRS) {
      const n = { x: c.x + d.x, y: c.y + d.y };
      if (prev.has(key(n)) || !isWalkable(env, n, blocked)) continue;
      prev.set(key(n), c);
      if (goalSet.has(key(n))) {
        const path = [n];
        let p: Point | null = c;
        while (p) { path.unshift(p); p = prev.get(key(p)) ?? null; }
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

/** Free tiles next to an object (where a character stands to use it). */
export function approachTiles(env: Environment, obj: GameObject): Point[] {
  if (!obj.pos) return [];
  const blocked = blockedTiles(env.objects);
  const res: Point[] = [];
  for (let x = obj.pos.x - 1; x <= obj.pos.x + obj.w; x++) for (let y = obj.pos.y - 1; y <= obj.pos.y + obj.h; y++) {
    const inside = x >= obj.pos.x && x < obj.pos.x + obj.w && y >= obj.pos.y && y < obj.pos.y + obj.h;
    const corner = (x === obj.pos.x - 1 || x === obj.pos.x + obj.w) && (y === obj.pos.y - 1 || y === obj.pos.y + obj.h);
    if (!inside && !corner && isWalkable(env, { x, y }, blocked)) res.push({ x, y });
  }
  return res;
}

/** Deterministic start positions: characters spread over free tiles (seeded by index). */
export function startPositions(env: Environment, characterIds: string[]): Record<string, Point> {
  const blocked = blockedTiles(env.objects);
  const free: Point[] = [];
  for (const r of env.rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++)
    if (isWalkable(env, { x, y }, blocked)) free.push({ x, y });
  const out: Record<string, Point> = {};
  characterIds.forEach((id, i) => {
    const idx = Math.floor(((i * 0.618034 + 0.31) % 1) * free.length);
    out[id] = free.splice(Math.min(idx, free.length - 1), 1)[0] ?? { x: 1, y: 1 };
  });
  return out;
}
