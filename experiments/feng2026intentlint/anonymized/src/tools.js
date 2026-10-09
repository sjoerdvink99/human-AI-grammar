// Deterministic tool steps.
//   tool_1 extract : r1 (dataset record)            -> r4 (data profile record)
//   tool_2 compose : r9* (picked suggestions) + r2_1* -> r2_2* (library)
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 5 * 1024 * 1024;

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) throw new Error('CSV is empty');
  const header = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function inferType(values) {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (!present.length) return 'empty';
  if (present.every((v) => typeof v === 'boolean' || /^(true|false)$/i.test(String(v)))) return 'boolean';
  if (present.every((v) => typeof v === 'number' || (String(v).trim() !== '' && !isNaN(Number(v))))) {
    return present.every((v) => Number.isInteger(Number(v)) && !String(v).includes('.')) ? 'integer' : 'float';
  }
  if (present.every((v) => /^\d{4}-\d{2}-\d{2}([ T][\d:.]+Z?)?$/.test(String(v)) && !isNaN(Date.parse(v)))) return 'datetime';
  const unique = new Set(present.map(String)).size;
  return unique <= Math.max(20, present.length * 0.2) ? 'categorical' : 'text';
}

/** tool_1 extract: r1 -> r4 */
export function extractProfile(r1) {
  if (!r1 || typeof r1.content !== 'string') throw new Error('No dataset loaded');
  if (r1.content.length > MAX_BYTES) throw new Error('Dataset larger than 5 MB');
  const format = r1.format || (r1.name?.toLowerCase().endsWith('.json') ? 'json' : 'csv');
  let rows;
  if (format === 'json') {
    const parsed = JSON.parse(r1.content);
    rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
    if (!rows || !rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
      throw new Error('JSON dataset must be an array of objects');
    }
  } else rows = parseCsv(r1.content);

  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const columns = names.map((name) => {
    const values = rows.map((r) => r[name]);
    const type = inferType(values);
    const present = values.filter((v) => v !== null && v !== undefined && v !== '');
    const col = {
      name,
      type,
      missing: values.length - present.length,
      unique: new Set(present.map(String)).size,
      examples: [...new Set(present.map(String))].slice(0, 5),
    };
    if (type === 'integer' || type === 'float') {
      const nums = present.map(Number);
      col.min = Math.min(...nums);
      col.max = Math.max(...nums);
      col.mean = +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4);
    } else if (type === 'datetime') {
      const sorted = present.map(String).sort();
      col.min = sorted[0];
      col.max = sorted[sorted.length - 1];
    }
    return col;
  });
  return { name: r1.name || 'dataset', format, rowCount: rows.length, columns };
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** tool_2 compose: r9* + r2_1* -> r2_2* */
export function composeLibrary(library, picked) {
  const out = library.map((g) => ({ ...g }));
  const seen = new Set(out.map((g) => norm(g.title)));
  const added = [];
  for (const s of picked) {
    const title = String(s.title || '').trim();
    const instruction = String(s.instruction || '').trim();
    if (!title || !instruction) continue;
    if (seen.has(norm(title))) continue;
    seen.add(norm(title));
    const g = {
      id: `g_${randomUUID().slice(0, 8)}`,
      title,
      when: String(s.when || '').trim(),
      instruction,
      source: 'suggested',
      updatedAt: new Date().toISOString(),
    };
    out.push(g);
    added.push(g.id);
  }
  return { library: out, added };
}

/** Validates a guideline record coming from the UI (process 3). */
export function validateGuideline(g) {
  const title = String(g?.title || '').trim();
  const instruction = String(g?.instruction || '').trim();
  if (!title) throw new Error('Guideline title is required');
  if (!instruction) throw new Error('Guideline instruction is required');
  if (title.length > 120) throw new Error('Guideline title must be at most 120 characters');
  return { title, instruction, when: String(g?.when || '').trim() };
}
