// Application state, named after the design's identifiers (without version).
// Versioned representations keep their history: r7 instruction, r8 guidelines, r9 profile, r15 taskLabels.
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const IMAGE_DIR = path.join(DATA_DIR, 'images');
const FILE = path.join(DATA_DIR, 'state.json');

export function emptyState() {
  return {
    images: [],            // r1  artifact visual*     {id, file, width, height}
    annotations: [],       // r2  artifact record*     {imageId, objects:[{label,bbox:[x,y,w,h]}]}
    regions: [],           // r3  selection spatial*   {id, imageId, bbox}
    objectLabels: [],      // r4  label categorical*   {regionId, label}
    captions: [],          // r5  artifact language*   {imageId, text}
    descriptions: [],      // r6  artifact language*   {imageId, text}
    instruction: { current: '', versions: [] },     // r7 (versions: [{v, text, at}])
    guidelines: { current: [], versions: [] },      // r8 {id, name, rule, label}
    profile: { current: { preferences: [], summary: '' }, versions: [] }, // r9
    taxonomy: { nodes: [] },                         // r10 {id, name, parent}
    suggestedGuidelines: [], // r11 {guidelineId, reason}
    activeGuidelines: [],    // r12 guidelineIds
    captionVectors: [],      // r13 {imageId, vector}
    guidelineVectors: [],    // r14 {guidelineId, vector}
    taskLabels: { current: [], versions: [] },       // r15 {imageId, label}
    rationales: [],          // r16 {imageId, text}
    rationaleScores: [],     // r17 {imageId, score}
    conceptLabels: [],       // r18 {imageId, conceptId}
    reviewNotes: [],         // r19 {imageId, text}
    noteScores: [],          // r20 {imageId, score}
    reviewQueue: [],         // r21 {imageId, priority:'review'|'auto'}
    humanReviews: [],        // r23 {imageId, verdict, comment, at}
    finalLabels: [],         // r24 {imageId, label}
    labeledExamples: [],     // r25 {imageId, label, concept, caption, rationale, verdict, comment, dialogue[]}
    assistantReply: null,    // r28 {imageId, question, text, suggestedLabel}
    replyReview: null,       // r29 {imageId, helpful, comment}
    patterns: [],            // r30 {label, features[]}
    candidateRules: [],      // r31 {id, name, rule, label}
    ruleMatches: [],         // r32 {candidateId, guidelineId|null}
    ruleAssessments: [],     // r33 {candidateId, action, reason}
    preferenceSummary: '',   // r34
    lastRun: null,           // which process produced the current labels ('p2'|'p7')
    log: [],
  };
}

let state = load();

function load() {
  try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { return emptyState(); }
}

export function getState() { return state; }
export function setState(next) { state = next; save(); }
export function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

/** Record a new version of a versioned representation, keeping earlier ones. */
export function pushVersion(key, value, meta = {}) {
  const rep = state[key];
  rep.current = value;
  rep.versions.push({ v: rep.versions.length + 1, value, at: new Date().toISOString(), ...meta });
  save();
}

export function log(msg) {
  state.log.push({ at: new Date().toISOString(), msg });
  state.log = state.log.slice(-200);
  console.log(msg);
}

/** Label space for task labels (r15/r24): labels named by guidelines plus "unclear". */
export function labelSpace(s = state) {
  return [...new Set([...s.guidelines.current.map((g) => g.label), 'unclear'])];
}
