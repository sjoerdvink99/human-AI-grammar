// JSON-file persistence for preference_memory, retrieval_policy and sessions (with version history).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DEFAULT_PREFERENCE_MEMORY = () => ({
  version: 1,
  sessions: 0,
  object_prefs: {},   // category -> weight (positive = user keeps/adds, negative = removes)
  constraints: [],    // learned spatial_constraints with weight and count
  user_scenes: [],    // finished sessions turned into retrievable scenes
});

export const DEFAULT_RETRIEVAL_POLICY = () => ({
  version: 1,
  w_embed: 0.5,       // weight of embedding similarity in scene scoring
  w_llm: 0.4,         // weight of model_4 relevance score
  w_pref: 0.3,        // weight of preference-memory match
  w_value: 0.3,       // weight of learned scene / affordance value
  temperature: 0.08,  // softmax temperature for sampling scenes
  k_candidates: 6,
  n_scenes: 2,
  scene_values: {},       // scene id -> running value estimate
  affordance_values: {},  // constraint key -> running value estimate
  lr: 0.3,
  episodes: 0,
});

function file(name) { return path.join(DATA_DIR, `${name}.json`); }

export function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback(); }
}
export function save(name, value) {
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
}

/** Versioned save: keeps the previous version in <name>.history.json so v1 → v2 can be compared. */
export function saveVersioned(name, value) {
  const prev = load(name, () => null);
  if (prev) {
    const hist = load(`${name}.history`, () => []);
    hist.push(prev);
    save(`${name}.history`, hist.slice(-20));
  }
  save(name, value);
}

export const getMemory = () => load('preference_memory', DEFAULT_PREFERENCE_MEMORY);
export const getPolicy = () => load('retrieval_policy', DEFAULT_RETRIEVAL_POLICY);

export function resetAll() {
  for (const n of ['preference_memory', 'retrieval_policy', 'preference_memory.history', 'retrieval_policy.history']) {
    try { fs.unlinkSync(file(n)); } catch { /* none */ }
  }
}

// Sessions (scene_1, retrieval_trace_1, interaction_log_1) are kept in memory and mirrored to disk.
const sessions = new Map();
export function putSession(s) { sessions.set(s.id, s); save(`session-${s.id}`, s); return s; }
export function getSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const s = load(`session-${id}`, () => null);
  if (s) sessions.set(id, s);
  return s;
}
