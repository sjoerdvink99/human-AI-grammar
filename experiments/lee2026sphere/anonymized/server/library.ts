// r2 (asset library) and r3 (reliability model): persistence + seed data + lexicon vectors.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AXES, type Asset, type Library, type Placement, type Reliability } from '../shared/types.ts';

const DATA = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(DATA, { recursive: true });

/** Keyword lexicon per axis; used by tools to vectorize asset text deterministically. */
export const LEXICON: Record<(typeof AXES)[number], string[]> = {
  seating: ['chair', 'sofa', 'couch', 'stool', 'bench', 'armchair', 'seat', 'ottoman', 'beanbag', 'seating'],
  sleeping: ['bed', 'mattress', 'crib', 'bunk', 'nightstand', 'sleep', 'bedroom'],
  storage: ['shelf', 'bookshelf', 'cabinet', 'wardrobe', 'dresser', 'drawer', 'chest', 'storage', 'rack', 'closet'],
  surface: ['table', 'desk', 'counter', 'island', 'surface', 'nightstand', 'console'],
  lighting: ['lamp', 'light', 'lighting', 'chandelier', 'sconce', 'lantern', 'cozy', 'bright'],
  plants: ['plant', 'tree', 'flower', 'fern', 'cactus', 'garden', 'green', 'planter'],
  electronics: ['tv', 'television', 'computer', 'monitor', 'speaker', 'console', 'screen', 'media', 'gaming'],
  cooking: ['stove', 'oven', 'fridge', 'refrigerator', 'sink', 'kitchen', 'cook', 'counter', 'island'],
  bathing: ['bath', 'bathtub', 'shower', 'toilet', 'vanity', 'bathroom'],
  work: ['desk', 'office', 'work', 'monitor', 'computer', 'study', 'filing', 'whiteboard'],
  relaxation: ['sofa', 'armchair', 'rug', 'cozy', 'relax', 'lounge', 'beanbag', 'hammock', 'fireplace'],
  decor: ['rug', 'painting', 'mirror', 'vase', 'decor', 'art', 'sculpture', 'clock', 'curtain'],
  outdoor: ['patio', 'garden', 'outdoor', 'grill', 'parasol', 'deck', 'balcony', 'hammock'],
  children: ['toy', 'crib', 'kids', 'child', 'play', 'bunk', 'nursery'],
  dining: ['dining', 'dinner', 'table', 'chair', 'eat', 'buffet', 'sideboard', 'meal'],
  reading: ['book', 'bookshelf', 'read', 'reading', 'library', 'armchair', 'lamp', 'study'],
};

export function lexiconVector(text: string): number[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return AXES.map((axis) => {
    const hits = words.filter((w) => LEXICON[axis].some((k) => w === k || w === `${k}s` || w === `${k}es`)).length;
    return Math.min(1, hits / 2);
  });
}

type SeedRow = [id: string, name: string, category: string, w: number, h: number, color: string, placement: Placement, tags: string, shape?: 'circle'];
const SEED: SeedRow[] = [
  ['sofa', 'Three-seat sofa', 'seating', 210, 90, '#7a8fb3', 'wall', 'sofa couch living lounge relax cozy'],
  ['loveseat', 'Loveseat', 'seating', 150, 85, '#8aa1c4', 'wall', 'sofa couch small relax'],
  ['armchair', 'Armchair', 'seating', 85, 85, '#b38a6d', 'free', 'armchair seat reading cozy relax'],
  ['dining_chair', 'Dining chair', 'seating', 45, 50, '#a0785a', 'free', 'chair dining seat'],
  ['office_chair', 'Office chair', 'seating', 60, 60, '#444c5c', 'free', 'chair office work desk', 'circle'],
  ['stool', 'Bar stool', 'seating', 40, 40, '#6b5844', 'free', 'stool seat kitchen counter', 'circle'],
  ['beanbag', 'Beanbag', 'seating', 80, 80, '#d98c5f', 'free', 'beanbag seat relax kids play', 'circle'],
  ['bed_double', 'Double bed', 'sleeping', 160, 200, '#c9b8a6', 'wall', 'bed sleep bedroom'],
  ['bed_single', 'Single bed', 'sleeping', 90, 200, '#c9c0a6', 'wall', 'bed sleep bedroom kids'],
  ['crib', 'Crib', 'sleeping', 70, 130, '#e3d5c0', 'wall', 'crib nursery child sleep'],
  ['nightstand', 'Nightstand', 'storage', 45, 40, '#8b6b4a', 'wall', 'nightstand bedroom drawer'],
  ['bookshelf', 'Bookshelf', 'storage', 100, 35, '#6e4f33', 'wall', 'bookshelf book reading storage library'],
  ['wardrobe', 'Wardrobe', 'storage', 120, 60, '#7d6750', 'wall', 'wardrobe closet storage bedroom'],
  ['dresser', 'Dresser', 'storage', 110, 50, '#93714f', 'wall', 'dresser drawer storage bedroom'],
  ['toy_chest', 'Toy chest', 'storage', 80, 45, '#e0b14a', 'wall', 'toy chest kids play storage'],
  ['coffee_table', 'Coffee table', 'surface', 110, 60, '#9c7b5b', 'center', 'table coffee living'],
  ['dining_table', 'Dining table', 'surface', 180, 90, '#8c6a48', 'center', 'dining table dinner meal eat'],
  ['round_table', 'Round table', 'surface', 100, 100, '#a27f5c', 'center', 'dining table round', 'circle'],
  ['desk', 'Desk', 'surface', 140, 70, '#7f6a55', 'wall', 'desk work office study computer'],
  ['side_table', 'Side table', 'surface', 45, 45, '#b0906e', 'free', 'table side lamp', 'circle'],
  ['floor_lamp', 'Floor lamp', 'lighting', 35, 35, '#f2d16b', 'free', 'lamp light reading cozy', 'circle'],
  ['table_lamp', 'Table lamp', 'lighting', 25, 25, '#f5dd8a', 'free', 'lamp light', 'circle'],
  ['potted_plant', 'Potted plant', 'plants', 45, 45, '#5c9a5a', 'corner', 'plant green planter', 'circle'],
  ['fern', 'Fern', 'plants', 40, 40, '#4f8a4d', 'free', 'fern plant green', 'circle'],
  ['tv_stand', 'TV on stand', 'electronics', 160, 45, '#2f3440', 'wall', 'tv television media screen'],
  ['computer', 'Computer + monitor', 'electronics', 60, 30, '#3a3f4c', 'free', 'computer monitor work screen'],
  ['speaker', 'Speaker', 'electronics', 30, 30, '#22252c', 'corner', 'speaker media music'],
  ['stove', 'Stove', 'cooking', 60, 60, '#d0d3d8', 'wall', 'stove oven kitchen cook'],
  ['fridge', 'Fridge', 'cooking', 70, 70, '#e6e8eb', 'wall', 'fridge refrigerator kitchen'],
  ['kitchen_island', 'Kitchen island', 'cooking', 180, 90, '#bfc5cc', 'center', 'island counter kitchen cook'],
  ['sink', 'Kitchen sink', 'cooking', 80, 60, '#c4ccd4', 'wall', 'sink kitchen counter'],
  ['bathtub', 'Bathtub', 'bathing', 170, 75, '#e9f1f5', 'wall', 'bath bathtub bathroom'],
  ['toilet', 'Toilet', 'bathing', 40, 65, '#f3f5f7', 'wall', 'toilet bathroom'],
  ['vanity', 'Vanity', 'bathing', 90, 50, '#d7dde2', 'wall', 'vanity sink bathroom mirror'],
  ['rug', 'Area rug', 'decor', 200, 140, '#c96f5b', 'center', 'rug decor cozy living'],
  ['mirror', 'Standing mirror', 'decor', 60, 20, '#bcd4e0', 'wall', 'mirror decor'],
  ['fireplace', 'Fireplace', 'decor', 150, 40, '#8a4b3a', 'wall', 'fireplace cozy relax warm'],
  ['whiteboard', 'Whiteboard', 'work', 150, 15, '#f7f7f2', 'wall', 'whiteboard office work'],
  ['filing_cabinet', 'Filing cabinet', 'work', 50, 60, '#77808c', 'wall', 'filing cabinet office storage work'],
  ['play_mat', 'Play mat', 'children', 150, 150, '#8fd0c4', 'center', 'play kids toy mat child'],
  ['grill', 'Grill', 'outdoor', 80, 60, '#3b3b3b', 'wall', 'grill outdoor patio cook'],
  ['parasol', 'Parasol', 'outdoor', 200, 200, '#e8c15a', 'center', 'parasol outdoor patio garden shade', 'circle'],
  ['lounger', 'Sun lounger', 'outdoor', 70, 190, '#e3e0d3', 'free', 'lounger outdoor patio relax deck'],
  ['hammock', 'Hammock', 'outdoor', 90, 250, '#d8b97a', 'free', 'hammock outdoor relax garden'],
];

export function seedLibrary(): Library {
  return {
    version: 1,
    assets: SEED.map(([id, name, category, w, h, color, placement, tags, shape]): Asset => {
      const description = `${name}: ${tags}`;
      return {
        id, name, category, w, h, color, placement, shape: shape ?? 'rect', source: 'seed',
        tags: tags.split(' '), description, vector: lexiconVector(`${category} ${tags} ${name}`),
      };
    }),
  };
}

export function seedReliability(): Reliability {
  return { version: 1, prior: 0.6, learningRate: 0.3, weights: {}, history: [] };
}

function load<T>(file: string, seed: () => T): T {
  const path = join(DATA, file);
  if (!existsSync(path)) { const v = seed(); writeFileSync(path, JSON.stringify(v, null, 2)); return v; }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
function save(file: string, value: unknown) { writeFileSync(join(DATA, file), JSON.stringify(value, null, 2)); }

export const store = {
  library: (): Library => load('library.json', seedLibrary),
  saveLibrary: (l: Library) => save('library.json', l),
  reliability: (): Reliability => load('reliability.json', seedReliability),
  saveReliability: (r: Reliability) => save('reliability.json', r),
  reset() { save('library.json', seedLibrary()); save('reliability.json', seedReliability()); },
};

export function reliabilityOf(r: Reliability, assetId: string) {
  return r.weights[assetId] ?? r.prior;
}
