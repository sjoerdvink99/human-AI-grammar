// Persistent store for r2 (guideline library, instruction record*).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.LIBRARY_FILE || join(ROOT, 'data', 'library.json');
const SEED = join(ROOT, 'data', 'seed-library.json');

export async function loadLibrary() {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    const seed = JSON.parse(await readFile(SEED, 'utf8'));
    await saveLibrary(seed);
    return seed;
  }
}

export async function saveLibrary(library) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(library, null, 2));
  return library;
}
