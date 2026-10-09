// tool_1: deterministic environment construction and spatial helpers.
import type { Character, Environment, GameObject, Layout, RoomLabel, Tile } from "./types";

/** P1.6 [tool_1 execute]: layout + room_labels → environment (tile grid with labelled rooms). */
export function buildEnvironment(layout: Layout, labels: RoomLabel[]): Environment {
  const tiles: Tile[][] = Array.from({ length: layout.height }, () =>
    Array.from({ length: layout.width }, () => "void" as Tile),
  );
  const set = (x: number, y: number, t: Tile) => {
    if (y >= 0 && y < layout.height && x >= 0 && x < layout.width) tiles[y][x] = t;
  };
  for (const r of layout.rooms)
    for (let y = r.y - 1; y <= r.y + r.h; y++)
      for (let x = r.x - 1; x <= r.x + r.w; x++) set(x, y, "wall");
  for (const r of layout.rooms)
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, "floor");
  for (const d of layout.doors) set(d.x, d.y, "door");

  return {
    width: layout.width,
    height: layout.height,
    tiles,
    rooms: layout.rooms.map((r) => {
      const l = labels.find((lb) => lb.roomId === r.id);
      return { ...r, name: l?.name || r.id, description: l?.description || "" };
    }),
  };
}

export function roomAt(env: Environment, x: number, y: number) {
  return env.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ?? null;
}

export function isFloor(env: Environment, x: number, y: number) {
  const t = env.tiles[y]?.[x];
  return t === "floor" || t === "door";
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

/** Free floor tiles of a room, excluding doorways' neighbours so doors stay passable. */
function freeTiles(env: Environment, roomId: string, taken: Set<string>) {
  const room = env.rooms.find((r) => r.id === roomId);
  const out: { x: number; y: number }[] = [];
  if (!room) return out;
  for (let y = room.y; y < room.y + room.h; y++)
    for (let x = room.x; x < room.x + room.w; x++) {
      if (env.tiles[y][x] !== "floor" || taken.has(key(x, y))) continue;
      const nearDoor = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => env.tiles[y + dy]?.[x + dx] === "door");
      if (!nearDoor) out.push({ x, y });
    }
  return out;
}

/**
 * Validation for P1.7 [model assign]: snap every object onto a free floor tile inside its room.
 * Requested positions are kept when valid; otherwise the nearest free tile in the room is used.
 */
export function snapObjects(env: Environment, objects: GameObject[]): GameObject[] {
  const taken = new Set<string>();
  const out: GameObject[] = [];
  for (const o of objects) {
    let roomId = o.roomId;
    if (!env.rooms.some((r) => r.id === roomId)) roomId = env.rooms[0]?.id ?? roomId;
    const free = freeTiles(env, roomId, taken);
    if (!free.length) continue; // room full: drop object
    let pos = free[0];
    if (o.x != null && o.y != null) {
      pos = free.reduce((best, p) =>
        Math.abs(p.x - o.x!) + Math.abs(p.y - o.y!) < Math.abs(best.x - o.x!) + Math.abs(best.y - o.y!) ? p : best,
      );
    }
    taken.add(key(pos.x, pos.y));
    out.push({ ...o, roomId, x: pos.x, y: pos.y });
  }
  return out;
}

/** Default start positions for characters without one: spread across rooms on free tiles. */
export function placeCharacters(env: Environment, objects: GameObject[], characters: Character[]): Character[] {
  const taken = new Set<string>(objects.filter((o) => o.x != null).map((o) => key(o.x!, o.y!)));
  characters.forEach((c) => {
    if (c.x != null && c.y != null && isFloor(env, c.x, c.y)) taken.add(key(c.x, c.y));
  });
  let i = 0;
  return characters.map((c) => {
    if (c.x != null && c.y != null && isFloor(env, c.x, c.y)) return c;
    for (let tries = 0; tries < env.rooms.length; tries++) {
      const room = env.rooms[(i + tries) % env.rooms.length];
      const free = freeTiles(env, room.id, taken);
      if (free.length) {
        const p = free[Math.floor(free.length / 2)];
        taken.add(key(p.x, p.y));
        i++;
        return { ...c, x: p.x, y: p.y };
      }
    }
    return c;
  });
}
