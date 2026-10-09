// Project persistence (JSON + PNG files on disk) and background jobs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Job, Project, Workspace } from '../shared/types.js';

export const DATA_DIR = path.resolve(process.env.SYSTEMX_DATA || 'data/projects');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const uid = (prefix = '') => prefix + crypto.randomBytes(5).toString('hex');

const cache = new Map<string, Project>();

export function projectDir(id: string) {
  return path.join(DATA_DIR, id);
}
export function filePath(projectId: string, file: string) {
  return path.join(projectDir(projectId), file);
}

export function createProject(name: string): Project {
  const p: Project = {
    id: uid('p_'),
    name,
    createdAt: Date.now(),
    imageCandidates: [],
    sourceVersions: [],
    workspaces: {},
  };
  fs.mkdirSync(projectDir(p.id), { recursive: true });
  saveProject(p);
  return p;
}

export function getProject(id: string): Project {
  const c = cache.get(id);
  if (c) return c;
  const f = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(f)) throw new HttpError(404, 'project not found');
  const p = JSON.parse(fs.readFileSync(f, 'utf8')) as Project;
  cache.set(id, p);
  return p;
}

export function listProjects() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((d) => fs.existsSync(path.join(DATA_DIR, d, 'project.json')))
    .map((d) => getProject(d))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, thumb: p.sourceVersions.at(-1)?.file }));
}

export function saveProject(p: Project) {
  cache.set(p.id, p);
  fs.writeFileSync(path.join(projectDir(p.id), 'project.json'), JSON.stringify(p, null, 1));
}

export function newWorkspace(sourceId: string): Workspace {
  return {
    sourceId,
    layerPlanHistory: [],
    planChat: [],
    workImages: [],
    decomposeLog: [],
    decomposeStatus: 'idle',
    elements: {},
    canvasHistory: [],
    material: { material: 'cardstock', thicknessMm: 0.6, minFeatureMm: 1.5, sheetWidthMm: 200, layerGapMm: 4 },
    prepare: { issues: [], chat: [] },
  };
}

export function getWorkspace(p: Project, sourceId?: string): Workspace {
  const sid = sourceId ?? p.activeSourceId;
  if (!sid) throw new HttpError(400, 'no source image yet');
  if (!p.workspaces[sid]) p.workspaces[sid] = newWorkspace(sid);
  return p.workspaces[sid];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---- jobs ----
const jobs = new Map<string, Job>();

export function startJob(kind: string, fn: (log: (s: string) => void) => Promise<unknown>): Job {
  const job: Job = { id: uid('j_'), kind, status: 'running', log: [] };
  jobs.set(job.id, job);
  const log = (s: string) => {
    job.log.push(s);
    console.log(`[${kind}] ${s}`);
  };
  fn(log)
    .then((r) => {
      job.result = r;
      job.status = 'done';
    })
    .catch((e) => {
      console.error(e);
      job.error = (e as Error).message;
      job.status = 'error';
    });
  return job;
}
export function getJob(id: string) {
  const j = jobs.get(id);
  if (!j) throw new HttpError(404, 'job not found');
  return j;
}
