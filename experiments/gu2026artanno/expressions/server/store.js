// Application state, persisted to data/state.json. Names follow the design identifiers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelTaxonomy } from './seed/taxonomy.js';
import { initialSkills, initialKnowledgeBase } from './seed/library.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const IMAGE_DIR = path.join(DATA_DIR, 'images');
export const CROP_DIR = path.join(DATA_DIR, 'crops');
const FILE = path.join(DATA_DIR, 'state.json');

export function emptyState() {
  return {
    artworks: [],            // artworks_1        {id,title,image,file,width,height}
    artworkMetadata: [],     // artwork_metadata_1 {artworkId,title,artist,year,medium,objects}
    boundingBoxes: [],       // bounding_boxes_1  {unitId,artworkId,x,y,w,h}
    basicLabels: [],         // basic_labels_1    {unitId,label}
    artworkDescriptions: [], // artwork_descriptions_1 {artworkId,text}
    unitDescriptions: [],    // unit_descriptions_1    {unitId,text}
    skillLibrary: { versions: [{ version: 1, createdAt: new Date().toISOString(), skills: initialSkills }] },
    knowledgeBase: { versions: [{ version: 1, createdAt: new Date().toISOString(), ...initialKnowledgeBase }] },
    labelTaxonomy,           // label_taxonomy_1
    runs: [],                // process 2 / 7 runs
    activeRunId: null,
    annotationFeedback: [],  // annotation_feedback_1 {id,runId,clusterId,unitId,verdict,comment}
    confirmedLabels: [],     // confirmed_labels_n   {unitId,labelId,source,runId,clusterId,ts}
    confirmedLabelsVersion: 1,
    interactionLogs: [],     // interaction_logs_n   {id,ts,type,...}
    interactionLogsVersion: 1,
    chat: [],                // {id, focus, question, answer, suggestedLabelId, decision}
    learning: [],            // process 5 + 6 rounds
  };
}

let state = null;

export function load() {
  if (state) return state;
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.mkdirSync(CROP_DIR, { recursive: true });
  state = fs.existsSync(FILE) ? { ...emptyState(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) } : emptyState();
  return state;
}

export function save() {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function reset(newState = emptyState()) {
  state = newState;
  save();
  return state;
}

export const latestSkills = (s = load()) => s.skillLibrary.versions.at(-1);
export const latestKB = (s = load()) => s.knowledgeBase.versions.at(-1);
export const getRun = (id, s = load()) => s.runs.find((r) => r.id === id);
export const unitById = (id, s = load()) => s.boundingBoxes.find((b) => b.unitId === id);

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
