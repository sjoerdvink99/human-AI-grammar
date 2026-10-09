// Project state (one project), mirrored to data/project.json. Version histories are kept where the design
// versions or loops over a representation (source_image, layer_plan, work_image, canvas).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_MATERIAL,
  IMAGE_SIZE,
  type Canvas,
  type Job,
  type JobStep,
  type ProjectState,
  type StoredSegment,
} from '../shared/types.ts';
import { newId } from './util.ts';
import { stripMask } from './mask.ts';

const DATA_DIR = join(process.cwd(), 'data');
const FILE = join(DATA_DIR, 'project.json');

export interface ServerState extends Omit<ProjectState, 'canvas' | 'grabbedElements'> {
  canvas?: Canvas<StoredSegment>;
  /** earlier canvas versions (for undo) */
  canvasHistory: Canvas<StoredSegment>[];
  /** segments produced by process 4 (segments_1) before composition */
  segments: StoredSegment[];
  grabbedElements: StoredSegment[];
}

const fresh = (): ServerState => ({
  imageCandidates: [],
  sourceImages: [],
  imageUpdates: [],
  layerPlans: [],
  layerItems: [],
  workImages: [],
  rounds: [],
  grab: { candidates: [] },
  grabbedElements: [],
  canvasHistory: [],
  canvasVersions: 0,
  segments: [],
  materialSettings: { ...DEFAULT_MATERIAL },
  constraintIssues: [],
});

export let state: ServerState = load();

function load(): ServerState {
  try {
    if (existsSync(FILE)) return { ...fresh(), ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    /* ignore corrupt file */
  }
  return fresh();
}

let saveTimer: NodeJS.Timeout | undefined;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(state));
  }, 200);
}

export function resetProject() {
  state = fresh();
  save();
}

export const currentSource = () => state.sourceImages.at(-1);
export const currentPlan = () => state.layerPlans.at(-1);
export const currentWork = () => state.workImages.at(-1);

/** Client view of the state: masks stripped, canvas history summarized. */
export function publicState(): ProjectState & { canvasHistoryLength: number } {
  const { canvas, canvasHistory, segments: _s, grabbedElements, ...rest } = state;
  return {
    ...rest,
    canvas: canvas ? { ...canvas, segments: canvas.segments.map(stripMask) } : undefined,
    grabbedElements: grabbedElements.map(stripMask),
    canvasHistoryLength: canvasHistory.length,
  };
}

/** tool_2 compose: segments_1* → canvas_1 (layers from confirmed layers, ordered back→front). */
export function composeCanvas(segments: StoredSegment[]): Canvas<StoredSegment> {
  const plan = currentPlan();
  const confirmed = state.confirmedLayers?.layerIds ?? plan?.layers.map((l) => l.id) ?? [];
  const layers = (plan?.layers ?? [])
    .filter((l) => confirmed.includes(l.id))
    .sort((a, b) => a.depth - b.depth)
    .map((l, i) => ({ id: l.id, name: l.name, depth: i, visible: true }));
  return { version: 1, width: IMAGE_SIZE, height: IMAGE_SIZE, layers, segments: segments.map((s) => ({ ...s })), note: 'composed' };
}

/** Commit a new canvas version (keeps the previous one for undo / comparison). */
export function commitCanvas(next: Canvas<StoredSegment>, note: string) {
  if (state.canvas) {
    state.canvasHistory.push(state.canvas);
    if (state.canvasHistory.length > 50) state.canvasHistory.shift();
  }
  state.canvasVersions += 1;
  state.canvas = { ...next, version: state.canvasVersions, note };
  save();
}

export function undoCanvas() {
  const prev = state.canvasHistory.pop();
  if (prev) {
    state.canvas = prev;
    save();
  }
}

// ---------- jobs: long model chains run in the background and report grammar steps ----------

export const jobs = new Map<string, Job>();

export interface JobCtx {
  step<T>(label: string, fn: () => Promise<T> | T, detail?: (r: T) => string): Promise<T>;
  note(label: string, detail?: string, status?: JobStep['status']): void;
}

export function startJob(kind: string, run: (ctx: JobCtx) => Promise<void>): Job {
  const job: Job = { id: newId('job'), kind, status: 'running', steps: [], startedAt: Date.now() };
  jobs.set(job.id, job);
  const ctx: JobCtx = {
    async step(label, fn, detail) {
      const s: JobStep = { step: label, status: 'running', at: Date.now() };
      job.steps.push(s);
      try {
        const r = await fn();
        s.status = 'done';
        s.detail = detail ? detail(r) : undefined;
        save();
        return r;
      } catch (e) {
        s.status = 'error';
        s.detail = e instanceof Error ? e.message : String(e);
        throw e;
      }
    },
    note(label, detail, status = 'done') {
      job.steps.push({ step: label, status, detail, at: Date.now() });
    },
  };
  run(ctx)
    .then(() => {
      job.status = 'done';
    })
    .catch((e) => {
      job.status = 'error';
      job.error = e instanceof Error ? e.message : String(e);
      console.error(`[job ${kind}]`, job.error);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      save();
    });
  return job;
}
