// tool parse: turns an uploaded file into (highlights: artifact record)*
import { randomUUID } from 'node:crypto';

/** @typedef {{id:string,text:string,book:string,author:string,location:string,addedAt:string}} Highlight */

function make(text, book = '', author = '', location = '') {
  return {
    id: randomUUID(),
    text: text.trim().replace(/\s+/g, ' '),
    book: (book || 'Unknown book').trim(),
    author: (author || '').trim(),
    location: (location || '').trim(),
    addedAt: new Date().toISOString(),
  };
}

/** Kindle "My Clippings.txt" */
function parseClippings(raw) {
  const out = [];
  for (const block of raw.split(/^==========\s*$/m)) {
    const lines = block.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const [titleLine, meta, ...rest] = lines;
    if (!/highlight/i.test(meta)) continue; // skip notes and bookmarks
    const m = titleLine.match(/^(.*)\(([^()]*)\)\s*$/);
    const book = m ? m[1] : titleLine;
    const author = m ? m[2] : '';
    const loc = (meta.match(/(?:location|page)\s+[\d-]+/i) || [''])[0];
    out.push(make(rest.join(' '), book, author, loc));
  }
  return out;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names) => header.findIndex((h) => names.includes(h));
  const t = idx(['text', 'highlight', 'quote']);
  const b = idx(['book', 'title', 'book title']);
  const a = idx(['author', 'authors']);
  const l = idx(['location', 'page']);
  if (t < 0) throw new Error('CSV needs a "text" (or "highlight") column');
  return lines.slice(1).map(parseCsvLine).filter((c) => c[t]?.trim())
    .map((c) => make(c[t], c[b], c[a], l >= 0 ? c[l] : ''));
}

function parseJson(raw) {
  const data = JSON.parse(raw);
  const arr = Array.isArray(data) ? data : data.highlights;
  if (!Array.isArray(arr)) throw new Error('JSON must be an array of highlights');
  return arr.filter((h) => (h.text || h.highlight || '').trim())
    .map((h) => make(h.text || h.highlight, h.book || h.title, h.author, h.location));
}

/** Plain text: paragraphs separated by blank lines; optional "— Author, Book" last line. */
function parsePlain(raw, defaults = {}) {
  return raw.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const lines = p.split(/\r?\n/);
    const last = lines[lines.length - 1].trim();
    const src = lines.length > 1 && last.match(/^[—–-]+\s*(.+?)(?:,\s*(.+))?$/);
    if (src) return make(lines.slice(0, -1).join(' '), src[2] || defaults.book, src[1], '');
    return make(p, defaults.book, defaults.author, '');
  });
}

/**
 * @param {string} raw file contents
 * @param {string} [filename]
 * @param {{book?:string,author?:string}} [defaults]
 * @returns {Highlight[]}
 */
export function parseHighlights(raw, filename = '', defaults = {}) {
  const name = filename.toLowerCase();
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (name.endsWith('.json') || /^[[{]/.test(trimmed)) return parseJson(trimmed);
  if (/^==========\s*$/m.test(raw)) return parseClippings(raw);
  if (name.endsWith('.csv')) return parseCsv(raw);
  return parsePlain(raw, defaults);
}
