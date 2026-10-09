// Static scene library searched by [tool_3 match]. Each scene lists its objects and the spatial
// affordances (natural-language text + machine-readable constraint) that it exemplifies.
import { tagsToVector, humanize, constraintKey } from './catalog.js';

const A = (type, a, b, params) => ({ type, a, ...(b ? { b } : {}), ...(params ? { params } : {}) });

const RAW = [
  {
    id: 'lib-bed-cozy', name: 'Cozy double bedroom', room: { width: 4.2, depth: 3.8 },
    tags: ['bedroom', 'sleep', 'cozy', 'relax', 'storage'],
    objects: { bed: 1, nightstand: 2, wardrobe: 1, rug: 1, floor_lamp: 1, plant: 1 },
    affordances: [A('against_wall', 'bed'), A('beside', 'nightstand', 'bed'), A('against_wall', 'wardrobe'),
      A('clearance', 'wardrobe', null, { min: 0.9 }), A('under', 'rug', 'bed'), A('corner', 'plant')],
  },
  {
    id: 'lib-bed-minimal', name: 'Minimal bedroom', room: { width: 3.6, depth: 3.4 },
    tags: ['bedroom', 'sleep', 'minimal', 'small'],
    objects: { bed: 1, nightstand: 1, dresser: 1 },
    affordances: [A('against_wall', 'bed'), A('beside', 'nightstand', 'bed'), A('far', 'dresser', 'bed', { min: 0.8 })],
  },
  {
    id: 'lib-bed-office', name: 'Bedroom with work corner', room: { width: 4.5, depth: 4.0 },
    tags: ['bedroom', 'sleep', 'work', 'modern', 'studio'],
    objects: { bed: 1, nightstand: 1, desk: 1, office_chair: 1, bookshelf: 1, wardrobe: 1 },
    affordances: [A('against_wall', 'bed'), A('against_wall', 'desk'), A('far', 'desk', 'bed', { min: 1.0 }),
      A('facing', 'office_chair', 'desk', { max: 1.0 }), A('near', 'bookshelf', 'desk', { max: 0.8 }), A('beside', 'nightstand', 'bed')],
  },
  {
    id: 'lib-office-focus', name: 'Focused home office', room: { width: 3.5, depth: 3.2 },
    tags: ['office', 'work', 'read', 'minimal', 'small'],
    objects: { desk: 1, office_chair: 1, bookshelf: 2, floor_lamp: 1, plant: 1 },
    affordances: [A('against_wall', 'desk'), A('facing', 'office_chair', 'desk', { max: 1.0 }),
      A('against_wall', 'bookshelf'), A('near', 'floor_lamp', 'desk', { max: 0.6 }), A('corner', 'plant')],
  },
  {
    id: 'lib-office-library', name: 'Library study', room: { width: 4.5, depth: 4.0 },
    tags: ['office', 'read', 'work', 'traditional', 'cozy', 'relax'],
    objects: { desk: 1, office_chair: 1, bookshelf: 3, armchair: 1, floor_lamp: 1, side_table: 1, rug: 1 },
    affordances: [A('against_wall', 'bookshelf'), A('near', 'floor_lamp', 'armchair', { max: 0.4 }),
      A('beside', 'side_table', 'armchair'), A('facing', 'office_chair', 'desk', { max: 1.0 }), A('under', 'rug', 'armchair'),
      A('near', 'armchair', 'bookshelf', { max: 1.2 })],
  },
  {
    id: 'lib-living-tv', name: 'TV living room', room: { width: 5.0, depth: 4.2 },
    tags: ['living_room', 'watch_tv', 'relax', 'modern', 'entertain'],
    objects: { sofa: 1, tv_stand: 1, coffee_table: 1, armchair: 1, rug: 1, floor_lamp: 1, plant: 1 },
    affordances: [A('against_wall', 'sofa'), A('facing', 'sofa', 'tv_stand', { min: 2.0, max: 3.5 }),
      A('against_wall', 'tv_stand'), A('near', 'coffee_table', 'sofa', { max: 0.5 }), A('under', 'rug', 'coffee_table'),
      A('facing', 'armchair', 'coffee_table', { max: 1.5 }), A('near', 'floor_lamp', 'sofa', { max: 0.4 }), A('corner', 'plant')],
  },
  {
    id: 'lib-living-conversation', name: 'Conversation lounge', room: { width: 5.0, depth: 4.5 },
    tags: ['living_room', 'entertain', 'relax', 'cozy', 'traditional', 'large'],
    objects: { sofa: 1, armchair: 2, coffee_table: 1, side_table: 1, rug: 1, bookshelf: 1, plant: 2 },
    affordances: [A('facing', 'armchair', 'sofa', { max: 3.0 }), A('near', 'coffee_table', 'sofa', { max: 0.6 }),
      A('centered', 'coffee_table', null, { radius: 1.0 }), A('under', 'rug', 'coffee_table'),
      A('beside', 'side_table', 'sofa'), A('against_wall', 'bookshelf'), A('corner', 'plant')],
  },
  {
    id: 'lib-living-music', name: 'Music living room', room: { width: 5.2, depth: 4.4 },
    tags: ['living_room', 'music', 'entertain', 'relax', 'traditional'],
    objects: { piano: 1, sofa: 1, armchair: 1, coffee_table: 1, floor_lamp: 1, rug: 1 },
    affordances: [A('against_wall', 'piano'), A('clearance', 'piano', null, { min: 1.0 }), A('far', 'piano', 'sofa', { min: 1.0 }),
      A('facing', 'sofa', 'piano', { max: 4.0 }), A('near', 'floor_lamp', 'piano', { max: 0.5 }), A('near', 'coffee_table', 'sofa', { max: 0.5 })],
  },
  {
    id: 'lib-dining-family', name: 'Family dining room', room: { width: 4.5, depth: 4.0 },
    tags: ['dining_room', 'eat', 'entertain', 'traditional', 'large'],
    objects: { dining_table: 1, dining_chair: 6, sideboard: 1, plant: 1 },
    affordances: [A('centered', 'dining_table', null, { radius: 0.6 }), A('around', 'dining_chair', 'dining_table'),
      A('against_wall', 'sideboard'), A('far', 'sideboard', 'dining_table', { min: 0.9 }), A('corner', 'plant')],
  },
  {
    id: 'lib-dining-small', name: 'Small dining nook', room: { width: 3.2, depth: 3.0 },
    tags: ['dining_room', 'eat', 'minimal', 'small', 'modern'],
    objects: { dining_table: 1, dining_chair: 4, plant: 1 },
    affordances: [A('centered', 'dining_table', null, { radius: 0.5 }), A('around', 'dining_chair', 'dining_table'), A('corner', 'plant')],
  },
  {
    id: 'lib-kitchen-diner', name: 'Kitchen diner', room: { width: 5.0, depth: 4.0 },
    tags: ['kitchen', 'cook', 'eat', 'modern', 'entertain'],
    objects: { kitchen_counter: 1, fridge: 1, dining_table: 1, dining_chair: 4 },
    affordances: [A('against_wall', 'kitchen_counter'), A('beside', 'fridge', 'kitchen_counter'), A('against_wall', 'fridge'),
      A('clearance', 'kitchen_counter', null, { min: 1.0 }), A('around', 'dining_chair', 'dining_table'), A('far', 'dining_table', 'kitchen_counter', { min: 1.0 })],
  },
  {
    id: 'lib-studio', name: 'Studio apartment', room: { width: 5.5, depth: 4.5 },
    tags: ['studio', 'sleep', 'work', 'relax', 'cook', 'small', 'modern', 'minimal'],
    objects: { bed: 1, sofa: 1, desk: 1, office_chair: 1, kitchen_counter: 1, wardrobe: 1, rug: 1 },
    affordances: [A('against_wall', 'bed'), A('corner', 'bed'), A('far', 'sofa', 'bed', { min: 1.0 }), A('against_wall', 'desk'),
      A('facing', 'office_chair', 'desk', { max: 1.0 }), A('against_wall', 'kitchen_counter'), A('under', 'rug', 'sofa')],
  },
  {
    id: 'lib-kids', name: 'Kids bedroom', room: { width: 4.0, depth: 3.8 },
    tags: ['kids_room', 'play', 'sleep', 'cozy', 'storage'],
    objects: { bed: 1, toy_chest: 1, play_mat: 1, bookshelf: 1, nightstand: 1, desk: 1 },
    affordances: [A('against_wall', 'bed'), A('corner', 'bed'), A('centered', 'play_mat', null, { radius: 1.0 }),
      A('near', 'toy_chest', 'play_mat', { max: 0.6 }), A('against_wall', 'bookshelf'), A('beside', 'nightstand', 'bed')],
  },
  {
    id: 'lib-nursery', name: 'Nursery', room: { width: 3.6, depth: 3.4 },
    tags: ['kids_room', 'sleep', 'cozy', 'small', 'relax'],
    objects: { crib: 1, armchair: 1, dresser: 1, floor_lamp: 1, rug: 1 },
    affordances: [A('against_wall', 'crib'), A('near', 'armchair', 'crib', { max: 1.0 }), A('near', 'floor_lamp', 'armchair', { max: 0.4 }),
      A('against_wall', 'dresser'), A('under', 'rug', 'armchair')],
  },
  {
    id: 'lib-gym', name: 'Home gym & media', room: { width: 4.8, depth: 4.0 },
    tags: ['exercise', 'watch_tv', 'living_room', 'modern', 'large'],
    objects: { treadmill: 1, tv_stand: 1, mirror: 1, play_mat: 1, plant: 1 },
    affordances: [A('facing', 'treadmill', 'tv_stand', { max: 3.0 }), A('against_wall', 'mirror'), A('near', 'play_mat', 'mirror', { max: 1.0 }), A('corner', 'plant')],
  },
];

export function withAffordanceText(a, sceneId) {
  return { key: constraintKey(a), text: humanize(a), constraint: { type: a.type, a: a.a, ...(a.b ? { b: a.b } : {}), ...(a.params ? { params: a.params } : {}) }, source_scene: sceneId };
}

export const SCENE_LIBRARY = RAW.map((s) => ({
  ...s,
  source: 'library',
  vector: tagsToVector(s.tags),
  description: `${s.name}: ${Object.entries(s.objects).map(([c, n]) => (n > 1 ? `${n} ${c}s` : c)).join(', ').replace(/_/g, ' ')}. Tags: ${s.tags.join(', ')}.`,
  affordances: s.affordances.map((a) => withAffordanceText(a, s.id)),
}));
