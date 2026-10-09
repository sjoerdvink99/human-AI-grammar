import fs from 'node:fs';
import path from 'node:path';
import type { Project } from './types.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data/projects');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map<string, Project>();

export function projectDir(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad project id');
  return path.join(DATA_DIR, id);
}

export function loadProject(id: string): Project | null {
  if (cache.has(id)) return cache.get(id)!;
  const file = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(file)) return null;
  const p = JSON.parse(fs.readFileSync(file, 'utf8')) as Project;
  // A server restart interrupts any background job.
  if (p.busy) { p.error = `Interrupted: ${p.busy.task}`; p.busy = null; }
  for (const s of p.scenes ?? []) if (s.status === 'working') { s.status = 'error'; s.error = 'Interrupted'; }
  cache.set(id, p);
  return p;
}

export function saveProject(p: Project) {
  cache.set(p.id, p);
  const dir = projectDir(p.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'project.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, path.join(dir, 'project.json'));
}

export function listProjects(): Project[] {
  return fs.readdirSync(DATA_DIR)
    .filter((d) => fs.existsSync(path.join(DATA_DIR, d, 'project.json')))
    .map((d) => loadProject(d)!)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Run a project-level background job, recording progress in project.busy. */
export function runJob(p: Project, task: string, fn: (stage: (s: string) => void) => Promise<void>) {
  if (p.busy) throw new Error(`Busy: ${p.busy.task}`);
  p.busy = { task, stage: 'starting' };
  p.error = null;
  saveProject(p);
  const stage = (s: string) => { p.busy = { task, stage: s }; saveProject(p); };
  fn(stage)
    .catch((e) => { console.error(e); p.error = `${task} failed: ${e.message}`; })
    .finally(() => { p.busy = null; saveProject(p); });
}
