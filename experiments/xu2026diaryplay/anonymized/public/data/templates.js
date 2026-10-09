// r2: mapTemplates — (r2_1: artifact spatial)*
// Built-in grid maps. Each region is a rectangle on a COLS×ROWS tile grid.
// `kind` controls colouring only. Regions sharing an edge are adjacent (walkable between).
export const COLS = 16;
export const ROWS = 10;

const r = (id, kind, x, y, w, h, hint) => ({ id, kind, hint, rect: { x, y, w, h } });

export const MAP_TEMPLATES = [
  {
    id: 'village',
    name: 'Village',
    description: 'Two houses around a village square, with fields, a river bank and roads.',
    regions: [
      r('R1', 'indoor', 0, 0, 6, 5, 'house'),
      r('R2', 'road', 6, 0, 4, 3, 'path'),
      r('R3', 'indoor', 10, 0, 6, 5, 'house'),
      r('R4', 'outdoor', 6, 3, 4, 4, 'square'),
      r('R5', 'outdoor', 0, 5, 6, 5, 'field'),
      r('R6', 'road', 6, 7, 4, 3, 'road'),
      r('R7', 'water', 10, 5, 6, 5, 'river bank'),
    ],
  },
  {
    id: 'castle',
    name: 'Castle',
    description: 'A castle with a courtyard, great hall, tower, dungeon, chapel, garden and gate.',
    regions: [
      r('R1', 'indoor', 0, 0, 5, 5, 'tower'),
      r('R2', 'indoor', 5, 0, 6, 3, 'great hall'),
      r('R3', 'indoor', 11, 0, 5, 5, 'chapel'),
      r('R4', 'outdoor', 5, 3, 6, 4, 'courtyard'),
      r('R5', 'indoor', 0, 5, 5, 5, 'dungeon'),
      r('R6', 'road', 5, 7, 6, 3, 'gate'),
      r('R7', 'forest', 11, 5, 5, 5, 'garden'),
    ],
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Woods around a clearing, with trails, a lake and a cave.',
    regions: [
      r('R1', 'forest', 0, 0, 5, 10, 'deep woods'),
      r('R2', 'road', 5, 0, 6, 3, 'trail'),
      r('R3', 'water', 11, 0, 5, 6, 'lake'),
      r('R4', 'outdoor', 5, 3, 6, 4, 'clearing'),
      r('R5', 'indoor', 11, 6, 5, 4, 'cave'),
      r('R6', 'road', 5, 7, 6, 3, 'trail'),
    ],
  },
  {
    id: 'harbor',
    name: 'Harbor',
    description: 'A harbor town: market, tavern, warehouse, docks, a moored ship, lighthouse and sea.',
    regions: [
      r('R1', 'outdoor', 0, 0, 5, 6, 'market'),
      r('R2', 'indoor', 5, 0, 5, 3, 'tavern'),
      r('R3', 'indoor', 5, 3, 5, 3, 'warehouse'),
      r('R4', 'indoor', 10, 0, 6, 2, 'lighthouse'),
      r('R5', 'indoor', 10, 2, 6, 5, 'ship'),
      r('R6', 'road', 0, 6, 10, 4, 'docks'),
      r('R7', 'water', 10, 7, 6, 3, 'sea'),
    ],
  },
  {
    id: 'manor',
    name: 'Manor',
    description: 'The inside of a large house: a central hallway with kitchen, dining room, library and bedroom.',
    regions: [
      r('R1', 'indoor', 0, 0, 6, 4, 'kitchen'),
      r('R2', 'indoor', 0, 4, 6, 6, 'dining room'),
      r('R3', 'road', 6, 0, 4, 10, 'hallway'),
      r('R4', 'indoor', 10, 0, 6, 5, 'library'),
      r('R5', 'indoor', 10, 5, 6, 5, 'bedroom'),
    ],
  },
  {
    id: 'town',
    name: 'Town',
    description: 'A modern town: a main street lined with a shop, school, park, home, station and hospital.',
    regions: [
      r('R1', 'indoor', 0, 0, 5, 4, 'shop'),
      r('R2', 'indoor', 5, 0, 6, 4, 'school'),
      r('R3', 'forest', 11, 0, 5, 4, 'park'),
      r('R4', 'road', 0, 4, 16, 2, 'main street'),
      r('R5', 'indoor', 0, 6, 6, 4, 'home'),
      r('R6', 'indoor', 6, 6, 5, 4, 'station'),
      r('R7', 'indoor', 11, 6, 5, 4, 'hospital'),
    ],
  },
];

export function templateById(id) {
  return MAP_TEMPLATES.find((t) => t.id === id);
}
