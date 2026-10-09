// Object catalog shared by the scene generation engine (tool_1), the VR runtime (tool_2)
// and the context extraction pipeline (tool_4).
import type { SpatialConstraint } from './types';

export interface CatalogEntry {
  type: string;
  w: number;
  d: number;
  h: number;
  color: string;
  functions: string[]; // functional groups used for zone assignment
  aliases: string[];
  floorCover?: boolean; // rugs can overlap other objects
}

export const CATALOG: CatalogEntry[] = [
  { type: 'bed', w: 1.6, d: 2.05, h: 0.55, color: '#8fa7c9', functions: ['sleeping'], aliases: ['double bed', 'beds'] },
  { type: 'single_bed', w: 0.95, d: 2.0, h: 0.5, color: '#9cb4d4', functions: ['sleeping'], aliases: ['single bed', 'bunk'] },
  { type: 'nightstand', w: 0.45, d: 0.4, h: 0.55, color: '#a47551', functions: ['sleeping'], aliases: ['bedside table', 'night stand'] },
  { type: 'wardrobe', w: 1.2, d: 0.6, h: 2.0, color: '#7a5a3a', functions: ['storage'], aliases: ['closet', 'armoire'] },
  { type: 'dresser', w: 1.0, d: 0.5, h: 0.85, color: '#8c6a4a', functions: ['storage'], aliases: ['chest of drawers'] },
  { type: 'desk', w: 1.3, d: 0.65, h: 0.75, color: '#c49a6c', functions: ['work'], aliases: ['writing desk', 'workstation', 'table desk'] },
  { type: 'office_chair', w: 0.6, d: 0.6, h: 1.0, color: '#333944', functions: ['work'], aliases: ['office chair', 'desk chair'] },
  { type: 'bookshelf', w: 0.9, d: 0.35, h: 1.9, color: '#6b4f36', functions: ['reading', 'storage'], aliases: ['bookcase', 'shelf', 'shelves'] },
  { type: 'armchair', w: 0.85, d: 0.85, h: 0.9, color: '#b5654b', functions: ['reading', 'lounging'], aliases: ['arm chair', 'reading chair'] },
  { type: 'floor_lamp', w: 0.35, d: 0.35, h: 1.6, color: '#e8d9a8', functions: ['reading', 'lighting'], aliases: ['floor lamp', 'lamp', 'standing lamp'] },
  { type: 'sofa', w: 2.1, d: 0.9, h: 0.85, color: '#6d7f8f', functions: ['lounging'], aliases: ['couch', 'settee'] },
  { type: 'coffee_table', w: 1.1, d: 0.6, h: 0.42, color: '#a88a64', functions: ['lounging'], aliases: ['coffee table'] },
  { type: 'tv_stand', w: 1.6, d: 0.45, h: 0.55, color: '#2f2f35', functions: ['lounging', 'media'], aliases: ['tv', 'television', 'tv stand', 'media console'] },
  { type: 'dining_table', w: 1.6, d: 0.9, h: 0.75, color: '#b0895e', functions: ['dining'], aliases: ['dining table', 'table'] },
  { type: 'dining_chair', w: 0.48, d: 0.5, h: 0.9, color: '#8d6e4f', functions: ['dining'], aliases: ['dining chair', 'chair', 'chairs'] },
  { type: 'kitchen_counter', w: 2.4, d: 0.65, h: 0.9, color: '#d8d4cc', functions: ['cooking'], aliases: ['counter', 'kitchen counter', 'countertop'] },
  { type: 'fridge', w: 0.7, d: 0.7, h: 1.85, color: '#e6e9ec', functions: ['cooking'], aliases: ['refrigerator'] },
  { type: 'kitchen_island', w: 1.5, d: 0.9, h: 0.9, color: '#cfc6b8', functions: ['cooking'], aliases: ['kitchen island', 'island'] },
  { type: 'plant', w: 0.45, d: 0.45, h: 1.2, color: '#4f8a4b', functions: ['decor'], aliases: ['plants', 'potted plant'] },
  { type: 'rug', w: 2.0, d: 1.4, h: 0.02, color: '#c9b79c', functions: ['decor'], aliases: ['carpet'], floorCover: true },
  { type: 'piano', w: 1.5, d: 0.6, h: 1.25, color: '#1d1d1f', functions: ['music'], aliases: ['upright piano'] },
  { type: 'side_table', w: 0.5, d: 0.5, h: 0.55, color: '#9a7b5a', functions: ['lounging', 'reading'], aliases: ['side table', 'end table'] },
  { type: 'crib', w: 0.75, d: 1.3, h: 0.95, color: '#f1e3c8', functions: ['sleeping'], aliases: ['cot', 'baby bed'] },
  { type: 'toy_box', w: 0.8, d: 0.45, h: 0.5, color: '#e07a5f', functions: ['play', 'storage'], aliases: ['toy box', 'toys'] },
  { type: 'filing_cabinet', w: 0.45, d: 0.6, h: 1.3, color: '#7d8590', functions: ['work', 'storage'], aliases: ['filing cabinet', 'cabinet'] },
];

export const CATALOG_BY_TYPE = new Map(CATALOG.map((c) => [c.type, c]));

export function catalogEntry(type: string): CatalogEntry {
  return CATALOG_BY_TYPE.get(type) ?? { type, w: 0.6, d: 0.6, h: 0.8, color: '#999999', functions: ['misc'], aliases: [] };
}

/** Normalises a free-text object name ("couch", "floor lamp") to a catalog type, or null. */
export function normalizeType(name: string): string | null {
  const n = name.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/^(the|a|an)\s+/, '').replace(/s$/, '');
  for (const c of CATALOG) {
    const variants = [c.type.replace(/_/g, ' '), ...c.aliases].map((v) => v.replace(/s$/, ''));
    if (variants.includes(n)) return c.type;
  }
  return null;
}

/** Typical contents of each room type, used when the request does not list objects. */
export const ROOM_TEMPLATES: Record<string, { size: [number, number]; objects: string[] }> = {
  bedroom: { size: [4.2, 4.6], objects: ['bed', 'nightstand', 'nightstand', 'wardrobe', 'dresser', 'rug', 'plant'] },
  living_room: { size: [5.5, 5.0], objects: ['sofa', 'coffee_table', 'tv_stand', 'armchair', 'rug', 'floor_lamp', 'plant', 'bookshelf'] },
  office: { size: [4.0, 4.0], objects: ['desk', 'office_chair', 'bookshelf', 'filing_cabinet', 'floor_lamp', 'plant'] },
  study: { size: [3.8, 4.0], objects: ['desk', 'office_chair', 'bookshelf', 'bookshelf', 'armchair', 'floor_lamp', 'rug'] },
  dining_room: { size: [4.5, 4.2], objects: ['dining_table', 'dining_chair', 'dining_chair', 'dining_chair', 'dining_chair', 'dresser', 'plant'] },
  kitchen: { size: [4.2, 3.8], objects: ['kitchen_counter', 'fridge', 'kitchen_island', 'dining_chair', 'dining_chair', 'plant'] },
  nursery: { size: [3.6, 3.8], objects: ['crib', 'dresser', 'armchair', 'toy_box', 'rug', 'floor_lamp'] },
  studio: { size: [6.0, 5.5], objects: ['bed', 'nightstand', 'sofa', 'coffee_table', 'desk', 'office_chair', 'kitchen_counter', 'fridge', 'rug', 'plant'] },
};

export const ROOM_KEYWORDS: [RegExp, string][] = [
  [/nursery|baby/i, 'nursery'],
  [/bed ?room|sleep/i, 'bedroom'],
  [/living ?room|lounge|family room/i, 'living_room'],
  [/home office|office|workspace/i, 'office'],
  [/study|library/i, 'study'],
  [/dining/i, 'dining_room'],
  [/kitchen/i, 'kitchen'],
  [/studio|apartment|loft/i, 'studio'],
];

/** Placement habits that every layout starts from (source = 'default'). */
export const DEFAULT_CONSTRAINTS: SpatialConstraint[] = [
  { kind: 'against_wall', subject: 'bed', weight: 1, source: 'default' },
  { kind: 'against_wall', subject: 'single_bed', weight: 1, source: 'default' },
  { kind: 'near', subject: 'nightstand', object: 'bed', weight: 1.5, source: 'default' },
  { kind: 'against_wall', subject: 'wardrobe', weight: 1.5, source: 'default' },
  { kind: 'against_wall', subject: 'dresser', weight: 1, source: 'default' },
  { kind: 'against_wall', subject: 'bookshelf', weight: 1.5, source: 'default' },
  { kind: 'against_wall', subject: 'desk', weight: 1, source: 'default' },
  { kind: 'near', subject: 'office_chair', object: 'desk', weight: 2, source: 'default' },
  { kind: 'facing', subject: 'office_chair', object: 'desk', weight: 1, source: 'default' },
  { kind: 'against_wall', subject: 'sofa', weight: 0.8, source: 'default' },
  { kind: 'near', subject: 'coffee_table', object: 'sofa', weight: 1.5, source: 'default' },
  { kind: 'against_wall', subject: 'tv_stand', weight: 1.5, source: 'default' },
  { kind: 'facing', subject: 'sofa', object: 'tv_stand', weight: 1, source: 'default' },
  { kind: 'near', subject: 'dining_chair', object: 'dining_table', weight: 2, source: 'default' },
  { kind: 'facing', subject: 'dining_chair', object: 'dining_table', weight: 1, source: 'default' },
  { kind: 'centered', subject: 'dining_table', weight: 0.5, source: 'default' },
  { kind: 'against_wall', subject: 'kitchen_counter', weight: 2, source: 'default' },
  { kind: 'against_wall', subject: 'fridge', weight: 2, source: 'default' },
  { kind: 'centered', subject: 'rug', weight: 0.8, source: 'default' },
  { kind: 'in_corner', subject: 'plant', weight: 0.6, source: 'default' },
  { kind: 'against_wall', subject: 'piano', weight: 1.5, source: 'default' },
  { kind: 'against_wall', subject: 'filing_cabinet', weight: 1, source: 'default' },
  { kind: 'near', subject: 'side_table', object: 'armchair', weight: 1, source: 'default' },
  { kind: 'against_wall', subject: 'crib', weight: 1, source: 'default' },
  { kind: 'against_wall', subject: 'toy_box', weight: 0.8, source: 'default' },
  { kind: 'away_from_door', subject: 'bed', weight: 0.5, source: 'default' },
];

export const NAMED_COLORS: Record<string, string> = {
  red: '#c0392b', blue: '#2e6fb7', green: '#3f8f4f', yellow: '#e2c044', orange: '#e07b39', purple: '#7d4fa0',
  pink: '#e48fb0', white: '#f2f2f2', black: '#1e1e1e', grey: '#8a8a8a', gray: '#8a8a8a', brown: '#7a5232',
  beige: '#d8c7a6', teal: '#2a9d8f', navy: '#23395d', oak: '#b58b5a', walnut: '#5c4033',
};
