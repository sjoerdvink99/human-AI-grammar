// Application state: artworks (+metadata, units), skill_library, knowledge_base, label_taxonomy, tasks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const IMAGE_DIR = path.join(DATA_DIR, 'images');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export const DEFAULT_TAXONOMY = {
  label: 'Implicit meaning',
  children: [
    { label: 'Auspicious symbolism', children: [
      { label: 'Longevity' }, { label: 'Wealth and prosperity' }, { label: 'Abundance / surplus' },
      { label: 'Good fortune / blessings' }, { label: 'Official rank and success' }] },
    { label: 'Moral and scholarly virtue', children: [
      { label: 'Integrity / uprightness' }, { label: 'Resilience in adversity' }, { label: 'Purity' }, { label: 'Reclusion / withdrawal from the world' }] },
    { label: 'Relationships', children: [
      { label: 'Marital harmony' }, { label: 'Fertility / many descendants' }, { label: 'Friendship' }] },
    { label: 'Seasonal and temporal', children: [
      { label: 'Spring / renewal' }, { label: 'Winter / endurance' }, { label: 'Transience' }] },
    { label: 'Spiritual', children: [{ label: 'Immortality / transcendence' }, { label: 'Protection from evil' }] },
  ],
};

export const DEFAULT_SKILLS = [
  { id: 'sk-homophone', name: 'Check visual puns (homophones)', applies_to: 'symbolic meanings in East Asian decorative art',
    procedure: ['Name each depicted object in the source language', 'List words that sound alike', 'Map homophones to auspicious phrases', 'Confirm with combinations of motifs'],
    cues: ['bats', 'fish', 'vases', 'deer'], version: 1, parent: null, origin: 'seed' },
  { id: 'sk-motif-combo', name: 'Read motif combinations', applies_to: 'meanings that emerge only from paired motifs',
    procedure: ['Identify co-occurring motifs within one artwork', 'Look up conventional pairings (e.g. pine + crane)', 'Prefer the combined meaning over single-motif readings'],
    cues: ['pine and crane', 'mandarin ducks', 'three friends of winter'], version: 1, parent: null, origin: 'seed' },
  { id: 'sk-season', name: 'Use seasonal context', applies_to: 'temporal or seasonal meanings',
    procedure: ['Determine the season from plants and weather', 'Relate season to virtue or life-stage metaphors', 'Check the inscription/metadata for dates'],
    cues: ['plum blossom in snow', 'lotus in summer', 'chrysanthemum in autumn'], version: 1, parent: null, origin: 'seed' },
  { id: 'sk-metadata-first', name: 'Start from catalogue metadata', applies_to: 'any annotation task',
    procedure: ['Read title, period and origin first', 'Note the function of the object (gift, ritual, decoration)', 'Use function to rank candidate meanings'],
    cues: ['birthday gift', 'wedding object'], version: 1, parent: null, origin: 'seed' },
  { id: 'sk-color', name: 'Interpret colour symbolism', applies_to: 'meanings carried by colour',
    procedure: ['List dominant colours', 'Map colours to conventional associations in the culture of origin', 'Down-weight colour if pigment may be faded'],
    cues: ['red', 'gold', 'white'], version: 1, parent: null, origin: 'seed' },
];

export const DEFAULT_KNOWLEDGE = {
  entries: [
    { concept: 'crane', meaning: 'Longevity; carrier of immortals', evidence: 'conventional motif', source: 'seed' },
    { concept: 'peony', meaning: 'Wealth, honour, rank ("king of flowers")', evidence: 'conventional motif', source: 'seed' },
  ],
};

function emptyState() {
  return {
    artworks: [],
    skillLibrary: { version: 1, skills: structuredClone(DEFAULT_SKILLS), history: [] },
    knowledgeBase: { version: 1, ...structuredClone(DEFAULT_KNOWLEDGE), history: [] },
    labelTaxonomy: structuredClone(DEFAULT_TAXONOMY),
    tasks: [],
    learningRuns: [],
  };
}

let state = null;
export function getState() {
  if (state) return state;
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : emptyState();
  return state;
}
export function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
}
export function resetState() { fs.mkdirSync(IMAGE_DIR, { recursive: true }); state = emptyState(); save(); return state; }

export const imagePath = (a) => path.join(IMAGE_DIR, a.file);
export const findArtwork = (id) => getState().artworks.find((a) => a.id === id);
export const findTask = (id) => getState().tasks.find((t) => t.id === id);

/** Leaves of the label taxonomy (the allowed label set). */
export function taxonomyLeaves(node = getState().labelTaxonomy, out = []) {
  if (!node.children?.length) out.push(node.label);
  else node.children.forEach((c) => taxonomyLeaves(c, out));
  return out;
}
export function taxonomyOutline(node = getState().labelTaxonomy, depth = 0) {
  return '  '.repeat(depth) + '- ' + node.label + '\n' + (node.children || []).map((c) => taxonomyOutline(c, depth + 1)).join('');
}

/** All units (detected regions, plus one whole-artwork unit) across prepared artworks. */
export function allUnits() {
  return getState().artworks.flatMap((a) => (a.units || []).map((u) => ({ ...u, artworkId: a.id })));
}

export const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8);
