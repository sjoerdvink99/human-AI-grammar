import type { Layout } from "./types";

// (layouts_1: artifact spatial)* — the built-in library of floor plans.
// Room rectangles are interior floor areas; walls are drawn around them by tool_1.
export const LAYOUTS: Layout[] = [
  {
    id: "studio",
    name: "Studio (2 rooms)",
    width: 18,
    height: 11,
    rooms: [
      { id: "r1", x: 1, y: 1, w: 8, h: 9 },
      { id: "r2", x: 10, y: 1, w: 7, h: 9 },
    ],
    doors: [{ x: 9, y: 5 }],
  },
  {
    id: "cottage",
    name: "Cottage (3 rooms)",
    width: 20,
    height: 13,
    rooms: [
      { id: "r1", x: 1, y: 1, w: 9, h: 5 },
      { id: "r2", x: 11, y: 1, w: 8, h: 5 },
      { id: "r3", x: 1, y: 7, w: 18, h: 5 },
    ],
    doors: [
      { x: 10, y: 3 },
      { x: 5, y: 6 },
      { x: 14, y: 6 },
    ],
  },
  {
    id: "apartment",
    name: "Apartment (4 rooms)",
    width: 22,
    height: 15,
    rooms: [
      { id: "r1", x: 1, y: 1, w: 10, h: 6 },
      { id: "r2", x: 12, y: 1, w: 9, h: 6 },
      { id: "r3", x: 1, y: 8, w: 10, h: 6 },
      { id: "r4", x: 12, y: 8, w: 9, h: 6 },
    ],
    doors: [
      { x: 11, y: 3 },
      { x: 5, y: 7 },
      { x: 16, y: 7 },
      { x: 11, y: 11 },
    ],
  },
  {
    id: "hall",
    name: "Hall with wings (5 rooms)",
    width: 26,
    height: 15,
    rooms: [
      { id: "r1", x: 1, y: 1, w: 7, h: 6 },
      { id: "r2", x: 1, y: 8, w: 7, h: 6 },
      { id: "r3", x: 9, y: 1, w: 8, h: 13 },
      { id: "r4", x: 18, y: 1, w: 7, h: 6 },
      { id: "r5", x: 18, y: 8, w: 7, h: 6 },
    ],
    doors: [
      { x: 8, y: 3 },
      { x: 8, y: 11 },
      { x: 17, y: 3 },
      { x: 17, y: 11 },
      { x: 4, y: 7 },
      { x: 21, y: 7 },
    ],
  },
  {
    id: "manor",
    name: "Manor (6 rooms)",
    width: 28,
    height: 15,
    rooms: [
      { id: "r1", x: 1, y: 1, w: 8, h: 6 },
      { id: "r2", x: 10, y: 1, w: 8, h: 6 },
      { id: "r3", x: 19, y: 1, w: 8, h: 6 },
      { id: "r4", x: 1, y: 8, w: 8, h: 6 },
      { id: "r5", x: 10, y: 8, w: 8, h: 6 },
      { id: "r6", x: 19, y: 8, w: 8, h: 6 },
    ],
    doors: [
      { x: 9, y: 3 },
      { x: 18, y: 3 },
      { x: 9, y: 11 },
      { x: 18, y: 11 },
      { x: 4, y: 7 },
      { x: 13, y: 7 },
      { x: 22, y: 7 },
    ],
  },
];

export function getLayout(id: string | null): Layout | null {
  return LAYOUTS.find((l) => l.id === id) ?? null;
}
