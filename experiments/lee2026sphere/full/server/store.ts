// Persistent state: preference_memory, retrieval_policy (all versions kept) and per-session retrieval traces.
import fs from 'node:fs';
import path from 'node:path';
import type { PreferenceMemory, RetrievalPolicy, RetrievalTrace } from '../shared/types';
import { initReranker, seedFor } from './rerankers';
import { EMBEDDING_DIM } from './model3_embedding';

const DATA = path.resolve(process.env.DATA_DIR ?? 'data');
const HISTORY = path.join(DATA, 'history');
const SESSIONS = path.join(DATA, 'sessions');
for (const d of [DATA, HISTORY, SESSIONS]) fs.mkdirSync(d, { recursive: true });

const MEMORY_FILE = path.join(DATA, 'preference_memory.json');
const POLICY_FILE = path.join(DATA, 'retrieval_policy.json');

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}
function writeJson(file: string, data: unknown) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}

export function initialPolicy(): RetrievalPolicy {
  return {
    version: 1,
    temperature: 1.0,
    nCandidates: 8,
    kScenes: 2,
    kAffordances: 4,
    learningRate: 0.05,
    baseline: 0.5,
    sceneReranker: initReranker(EMBEDDING_DIM, 4, seedFor('model_4')),
    affordanceReranker: initReranker(EMBEDDING_DIM, 4, seedFor('model_5')),
    history: [],
  };
}

export function loadMemory(): PreferenceMemory {
  return readJson<PreferenceMemory>(MEMORY_FILE) ?? { version: 1, scenes: [] };
}
export function saveMemory(m: PreferenceMemory) {
  writeJson(MEMORY_FILE, m);
  writeJson(path.join(HISTORY, `preference_memory_${m.version}.json`), m);
}

export function loadPolicy(): RetrievalPolicy {
  return readJson<RetrievalPolicy>(POLICY_FILE) ?? initialPolicy();
}
export function savePolicy(p: RetrievalPolicy) {
  writeJson(POLICY_FILE, p);
  writeJson(path.join(HISTORY, `retrieval_policy_${p.version}.json`), p);
}

export function saveTrace(t: RetrievalTrace) {
  writeJson(path.join(SESSIONS, `${t.sessionId}.json`), t);
}
export function loadTrace(sessionId: string): RetrievalTrace | null {
  if (!/^[\w-]+$/.test(sessionId)) return null;
  return readJson<RetrievalTrace>(path.join(SESSIONS, `${sessionId}.json`));
}

export function resetAll() {
  for (const f of [MEMORY_FILE, POLICY_FILE]) fs.rmSync(f, { force: true });
}

export const TMP_DIR = path.join(DATA, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
