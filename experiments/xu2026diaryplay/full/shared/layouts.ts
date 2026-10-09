import type { Layout } from './types';

/**
 * layouts_1: (artifact spatial)* — the room layouts the model selects from.
 * Tiles inside a room or on a door are floor; everything else is wall.
 */
export const LAYOUTS: Layout[] = [
  {
    id: 'studio',
    name: 'Single room',
    description: 'One large open room (e.g. a studio flat, a classroom, a shop, a café).',
    width: 20, height: 14,
    rooms: [{ id: 'A', x: 1, y: 1, w: 18, h: 12 }],
    doors: [],
  },
  {
    id: 'two-side',
    name: 'Two rooms side by side',
    description: 'Two rooms of similar size next to each other, joined by a door.',
    width: 20, height: 14,
    rooms: [
      { id: 'A', x: 1, y: 1, w: 9, h: 12 },
      { id: 'B', x: 11, y: 1, w: 8, h: 12 },
    ],
    doors: [{ x: 10, y: 7 }],
  },
  {
    id: 'two-stacked',
    name: 'Large room above a smaller room',
    description: 'A wide main room with a smaller room below it.',
    width: 20, height: 14,
    rooms: [
      { id: 'A', x: 1, y: 1, w: 18, h: 6 },
      { id: 'B', x: 1, y: 8, w: 18, h: 5 },
    ],
    doors: [{ x: 9, y: 7 }],
  },
  {
    id: 'three-rooms',
    name: 'Main room with two side rooms',
    description: 'One large main room on the left, two small rooms stacked on the right.',
    width: 20, height: 14,
    rooms: [
      { id: 'A', x: 1, y: 1, w: 11, h: 12 },
      { id: 'B', x: 13, y: 1, w: 6, h: 5 },
      { id: 'C', x: 13, y: 7, w: 6, h: 6 },
    ],
    doors: [{ x: 12, y: 3 }, { x: 12, y: 10 }, { x: 15, y: 6 }],
  },
  {
    id: 'four-rooms',
    name: 'Four rooms',
    description: 'Four rooms in a 2×2 grid, each connected to its neighbours.',
    width: 20, height: 14,
    rooms: [
      { id: 'A', x: 1, y: 1, w: 8, h: 6 },
      { id: 'B', x: 10, y: 1, w: 9, h: 6 },
      { id: 'C', x: 1, y: 8, w: 8, h: 5 },
      { id: 'D', x: 10, y: 8, w: 9, h: 5 },
    ],
    doors: [{ x: 9, y: 3 }, { x: 9, y: 10 }, { x: 4, y: 7 }, { x: 14, y: 7 }],
  },
  {
    id: 'apartment',
    name: 'Open living space with two private rooms',
    description: 'A big open living area with a medium room and a small room on the right (like an apartment with bedroom and bathroom).',
    width: 20, height: 14,
    rooms: [
      { id: 'A', x: 1, y: 1, w: 12, h: 12 },
      { id: 'B', x: 14, y: 1, w: 5, h: 7 },
      { id: 'C', x: 14, y: 9, w: 5, h: 4 },
    ],
    doors: [{ x: 13, y: 4 }, { x: 13, y: 10 }],
  },
];

export function getLayout(id: string | null | undefined): Layout | undefined {
  return LAYOUTS.find((l) => l.id === id);
}
