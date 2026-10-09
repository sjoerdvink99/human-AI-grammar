import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emptyProject, type Project } from "./types.ts";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
const PROJECT_FILE = path.join(DATA_DIR, "project.json");
mkdirSync(MEDIA_DIR, { recursive: true });

function load(): Project {
  if (!existsSync(PROJECT_FILE)) return emptyProject();
  try {
    const p = { ...emptyProject(), ...JSON.parse(readFileSync(PROJECT_FILE, "utf8")) } as Project;
    p.busy = null; // jobs do not survive a restart
    return p;
  } catch {
    return emptyProject();
  }
}

export let project: Project = load();

export function resetProject(): void {
  project = emptyProject();
}

let saving = Promise.resolve();
export function save(): Promise<void> {
  const snapshot = JSON.stringify(project, null, 2);
  saving = saving.then(() => writeFile(PROJECT_FILE, snapshot));
  return saving;
}

export async function putMedia(data: Buffer | string, ext: "wav" | "svg"): Promise<string> {
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, name), data);
  return `/media/${name}`;
}

export async function readMedia(url: string): Promise<string> {
  return readFile(path.join(MEDIA_DIR, path.basename(url)), "utf8");
}
