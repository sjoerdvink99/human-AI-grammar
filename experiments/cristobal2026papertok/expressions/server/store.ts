import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Project } from "./types.ts";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data/projects");

export function projectDir(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad project id");
  return path.join(DATA_DIR, id);
}

/** Absolute file path for a new media file, plus the URL under which it is served. */
export function mediaPath(id: string, name: string) {
  const file = path.join(projectDir(id), "media", name);
  return { file, url: `/media/${id}/${name}` };
}

/** Resolve a /media URL back to an absolute file path. */
export function mediaFile(url: string) {
  const m = url.match(/^\/media\/([a-z0-9-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`not a media url: ${url}`);
  return path.join(projectDir(m[1]), "media", m[2]);
}

export function uniqueName(prefix: string, ext: string) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
}

export async function createProject(): Promise<Project> {
  const id = crypto.randomUUID().slice(0, 8);
  const project: Project = { id, createdAt: new Date().toISOString() };
  await fs.mkdir(path.join(projectDir(id), "media"), { recursive: true });
  await save(project);
  return project;
}

export async function listProjects() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const ids = await fs.readdir(DATA_DIR);
  const out: { id: string; title: string; createdAt: string }[] = [];
  for (const id of ids) {
    try {
      const p = await load(id);
      out.push({ id, title: p.script?.title ?? p.paper?.title ?? "(untitled)", createdAt: p.createdAt });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function load(id: string): Promise<Project> {
  return JSON.parse(await fs.readFile(path.join(projectDir(id), "project.json"), "utf8"));
}

async function save(p: Project) {
  const file = path.join(projectDir(p.id), "project.json");
  await fs.writeFile(file + ".tmp", JSON.stringify(p, null, 2));
  await fs.rename(file + ".tmp", file);
}

const locks = new Map<string, Promise<unknown>>();

/** Serialised read-modify-write; keep long-running work outside `fn`. */
export async function update(id: string, fn: (p: Project) => void | Promise<void>): Promise<Project> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const p = await load(id);
    await fn(p);
    await save(p);
    return p;
  });
  locks.set(id, next.catch(() => undefined));
  return next;
}
