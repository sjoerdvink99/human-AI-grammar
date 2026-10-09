// tool_1 execute: deterministic placement of characters and objects on the selected map.
// Input:  map (r4), characters (r3*), objects (r6*), regionLabels (r5*)
// Output: placement (r7) — { [entityId]: {x, y} }

/** Cells of a region ordered from the centre outwards (deterministic). */
export function regionCells(region) {
  const { x, y, w, h } = region.rect;
  const cx = x + (w - 1) / 2;
  const cy = y + (h - 1) / 2;
  const cells = [];
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.push({ x: i, y: j });
  cells.sort((a, b) => {
    const da = Math.abs(a.x - cx) + Math.abs(a.y - cy);
    const db = Math.abs(b.x - cx) + Math.abs(b.y - cy);
    return da - db || a.y - b.y || a.x - b.x;
  });
  return cells;
}

export function regionAt(map, pos) {
  if (!pos) return null;
  return (
    map.regions.find(
      (r) => pos.x >= r.rect.x && pos.x < r.rect.x + r.rect.w && pos.y >= r.rect.y && pos.y < r.rect.y + r.rect.h,
    ) || null
  );
}

/** Pick a free cell in a region, preferring the centre; spreads entities with a stride. */
export function freeCellIn(region, occupied, stride = 0) {
  const cells = regionCells(region);
  const order = stride ? cells.filter((_, i) => i % 2 === 0).concat(cells.filter((_, i) => i % 2 === 1)) : cells;
  for (const c of order) if (!occupied.has(`${c.x},${c.y}`)) return c;
  return cells[0];
}

/**
 * Characters go to the region whose label their description mentions; otherwise round-robin.
 * Objects go to the region the model generated them in.
 */
export function layoutWorld({ map, characters, objects, regionLabels }) {
  const placement = {};
  const occupied = new Set();
  const take = (id, region) => {
    const c = freeCellIn(region, occupied, 1);
    occupied.add(`${c.x},${c.y}`);
    placement[id] = { x: c.x, y: c.y };
  };
  const nameOf = (rid) => (regionLabels.find((l) => l.regionId === rid)?.name || '').toLowerCase();

  characters.forEach((ch, i) => {
    const text = `${ch.description || ''} ${ch.persona || ''}`.toLowerCase();
    const mentioned = map.regions.find((r) => nameOf(r.id) && text.includes(nameOf(r.id)));
    take(ch.id, mentioned || map.regions[i % map.regions.length]);
  });
  for (const ob of objects) {
    const region = map.regions.find((r) => r.id === ob.region) || map.regions[0];
    take(ob.id, region);
  }
  return placement;
}
