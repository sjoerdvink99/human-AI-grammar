// tool_1: deterministic backend processing routines (PDF parsing, extraction, text composition).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { Paper } from './types.ts';

const run = promisify(execFile);

async function pdfInfo(pdf: string): Promise<Record<string, string>> {
  try {
    const { stdout } = await run('pdfinfo', [pdf]);
    const info: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) info[m[1].trim()] = m[2].trim();
    }
    return info;
  } catch {
    return {};
  }
}

async function firstPageText(pdf: string) {
  const { stdout } = await run('pdftotext', ['-f', '1', '-l', '1', '-layout', pdf, '-'], { maxBuffer: 1 << 24 });
  return stdout;
}

/** Read the uploaded PDF into the paper representation. */
export async function readPaper(pdf: string, fileName: string): Promise<Paper> {
  const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { maxBuffer: 1 << 26 });
  const text = stdout.replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 200) throw new Error('Could not extract text from this PDF (is it scanned?)');
  const info = await pdfInfo(pdf);
  const title = guessTitle(info.Title, await firstPageText(pdf), fileName);
  return { fileName, title, text, pages: Number(info.Pages ?? 0) };
}

export function guessTitle(metaTitle: string | undefined, page1: string, fileName: string) {
  if (metaTitle && metaTitle.length > 8 && !/^(untitled|microsoft word|.*\.(docx?|tex|dvi))/i.test(metaTitle)) return metaTitle;
  const lines = page1.split('\n').map((l) => l.trim()).filter((l) => l.length > 8 && !/arxiv|preprint|proceedings|copyright|doi|^\d+$/i.test(l));
  return lines[0]?.replace(/\s{2,}/g, ' ') ?? fileName.replace(/\.pdf$/i, '');
}

/** tool_1 extract (process 7): paper_screenshot — the first page as an image. */
export async function extractScreenshot(pdf: string, outDir: string) {
  const base = path.join(outDir, 'paper_screenshot');
  await run('pdftoppm', ['-f', '1', '-l', '1', '-png', '-r', '110', '-singlefile', pdf, base]);
  return base + '.png';
}

/** tool_1 extract (process 7): paper_authors — from PDF metadata, else a first-page heuristic. */
export async function extractAuthors(pdf: string, title: string): Promise<string[]> {
  const info = await pdfInfo(pdf);
  if (info.Author && /[a-z]/i.test(info.Author) && !/^(user|admin|author)$/i.test(info.Author)) {
    const fromMeta = splitAuthorList(info.Author);
    if (fromMeta.length) return fromMeta;
  }
  return authorsFromFirstPage(await firstPageText(pdf), title);
}

export function splitAuthorList(s: string): string[] {
  return s
    .split(/\s*(?:,|;|\band\b|&|·|\s{3,})\s*/)
    .map(cleanName)
    .filter((n) => looksLikeName(n));
}

function cleanName(n: string) {
  return n.replace(/[\d*†‡§¶∗♠♣♥♦✉]+/g, '').replace(/\s+/g, ' ').trim();
}

export function looksLikeName(n: string) {
  const words = n.split(' ');
  if (words.length < 2 || words.length > 4) return false;
  if (/university|institute|department|school|lab|inc\.|college|abstract|@/i.test(n)) return false;
  return words.every((w) => /^[A-ZÀ-Ý][\p{L}'.-]*$/u.test(w) || /^(van|von|de|der|da|di|del|la|le)$/.test(w));
}

export function authorsFromFirstPage(page1: string, title: string): string[] {
  const lines = page1.split('\n').map((l) => l.trim()).filter(Boolean);
  const titleWords = title.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
  let start = lines.findIndex((l) => l.toLowerCase().replace(/\s+/g, ' ').includes(titleWords));
  start = start < 0 ? 0 : start + 1;
  const names: string[] = [];
  for (const line of lines.slice(start, start + 15)) {
    if (/^abstract/i.test(line)) break;
    for (const n of splitAuthorList(line)) if (!names.includes(n)) names.push(n);
  }
  return names.slice(0, 12);
}

/** tool_1 compose (process 7): credit_text from the title and authors. */
export function composeCreditText(title: string, authors: string[]) {
  const who = authors.length === 0 ? '' : authors.length <= 4 ? authors.join(', ') : `${authors.slice(0, 3).join(', ')} et al.`;
  return [`Based on the paper:`, `“${title}”`, who].filter(Boolean).join('\n');
}

/** tool_1 compose (process 2): baseline_voice_style — the default fast-speaking narration style. */
export function composeBaselineVoiceStyle() {
  return 'Fast-paced short-form narration: speak quickly and clearly (about 180–200 words per minute), with energy, short pauses between sentences, and no long dramatic silences.';
}

/** Split narration into timed caption chunks (used by tool_2 compose). */
export function captionChunks(text: string, duration: number, maxWords = 6, maxLine = 22) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= maxWords || /[.!?;:]$/.test(w)) { chunks.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) chunks.push(cur.join(' '));
  const totalChars = chunks.reduce((s, c) => s + c.length + 2, 0) || 1;
  let t = 0;
  return chunks.map((c) => {
    const len = ((c.length + 2) / totalChars) * duration;
    const out = { text: wrap(c, maxLine), start: t, end: t + len };
    t += len;
    return out;
  });
}

export function wrap(s: string, max: number) {
  const lines: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); return d; }
