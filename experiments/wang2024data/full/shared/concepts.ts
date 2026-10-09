import type { Concept, ConceptType, Row, Table, Value } from './types';

const DATE_RE = /^\d{4}-\d{1,2}(-\d{1,2})?([ T]\d{1,2}:\d{2}(:\d{2})?)?|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

export function inferType(values: Value[]): ConceptType {
  const present = values.filter((v) => v !== null && v !== '' && v !== undefined);
  if (present.length === 0) return 'nominal';
  if (present.every((v) => typeof v === 'number')) return 'quantitative';
  if (present.every((v) => typeof v === 'boolean')) return 'nominal';
  if (present.every((v) => typeof v === 'string' && DATE_RE.test(v))) return 'temporal';
  return 'nominal';
}

/** Parse raw cell text into a typed value (numbers become numbers). */
export function parseCell(raw: unknown): Value {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  const s = String(raw).trim();
  if (s === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  return s;
}

export function columnValues(rows: Row[], col: string): Value[] {
  return rows.map((r) => (r[col] === undefined ? null : r[col]));
}

/**
 * [tool_1 extract]: table -> concepts*. Every column becomes a concept with an
 * inferred data type. Provenance of previously known concepts is kept.
 */
export function extractConcepts(table: Table, previous: Concept[] = []): Concept[] {
  return table.columns.map((name) => {
    const prev = previous.find((c) => c.name === name && c.source !== 'custom');
    const type = inferType(columnValues(table.rows, name));
    return prev ? { ...prev, type } : { name, type, source: 'original' as const };
  });
}

/**
 * [tool_1 assign]: after a reshape is accepted, concepts are re-extracted from the
 * new table; custom concepts that now exist as columns become 'reshaped' concepts,
 * custom concepts still missing stay on the shelf.
 */
export function assignConcepts(table: Table, previous: Concept[]): Concept[] {
  const fromTable = table.columns.map((name) => {
    const prev = previous.find((c) => c.name === name);
    const type = inferType(columnValues(table.rows, name));
    if (!prev) return { name, type, source: 'original' as const };
    if (prev.source === 'custom') return { name, type, source: 'reshaped' as const, examples: prev.examples };
    return { ...prev, type };
  });
  const pending = previous.filter((c) => c.source === 'custom' && !table.columns.includes(c.name));
  return [...fromTable, ...pending];
}
