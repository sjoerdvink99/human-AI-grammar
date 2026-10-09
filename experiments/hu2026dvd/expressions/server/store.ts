import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../shared/types';
import { seedProject } from './seed';

export const DATA_DIR = path.resolve(process.env.SYSTEMX_DATA ?? 'data');
export const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');

let cache: Project | null = null;
let writing: Promise<void> = Promise.resolve();

export async function loadProject(): Promise<Project> {
  if (cache) return cache;
  await mkdir(VIDEO_DIR, { recursive: true });
  cache = existsSync(PROJECT_FILE) ? JSON.parse(await readFile(PROJECT_FILE, 'utf8')) : seedProject();
  return cache!;
}

export async function saveProject(p: Project): Promise<void> {
  cache = p;
  writing = writing.then(async () => {
    const tmp = PROJECT_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(p, null, 2));
    await rename(tmp, PROJECT_FILE);
  });
  return writing;
}

export async function resetProject(): Promise<Project> {
  const p = seedProject();
  await saveProject(p);
  return p;
}
