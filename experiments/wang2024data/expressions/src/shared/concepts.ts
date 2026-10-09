import type { Cell, Concept, ConceptType, Table } from './types';

const DATE_RE = /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?([ T]\d{1,2}:\d{2}(:\d{2})?)?/;

export function isNumeric(v: Cell): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

/** Infer a Vega-Lite measurement type from the values of one column. */
export function inferType(values: Cell[]): ConceptType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (present.length === 0) return 'nominal';
  if (present.every((v) => typeof v === 'string' && DATE_RE.test(v))) return 'temporal';
  if (present.every(isNumeric)) {
    // Year-like integer columns are usually ordinal, but keep them quantitative so they can be plotted on a scale.
    return 'quantitative';
  }
  return 'nominal';
}

/** [tool_1 extract]: table_1 -> concepts_1* */
export function extractConcepts(table: Table): Concept[] {
  return table.columns.map((name) => ({
    name,
    type: inferType(table.rows.map((r) => r[name])),
    source: 'table' as const,
  }));
}

/**
 * [tool_1 assign]: attach concepts to a new table version.
 * Every column becomes a concept; derived concepts keep their derivation;
 * custom concepts that now have data become table concepts; custom concepts
 * that are still not in the table are kept so the user can use them later.
 */
export function assignConcepts(table: Table, previous: Concept[]): Concept[] {
  const byName = new Map(previous.map((c) => [c.name, c]));
  const fromTable: Concept[] = table.columns.map((name) => {
    const prev = byName.get(name);
    const type = inferType(table.rows.map((r) => r[name]));
    if (prev?.source === 'derived') return { ...prev, type };
    // Keep a user-declared type for custom concepts when values allow it.
    const declared = prev?.source === 'custom' && prev.type !== 'quantitative' ? prev.type : undefined;
    return { name, type: declared && type !== 'quantitative' ? declared : type, source: 'table' };
  });
  const remainingCustom = previous.filter((c) => c.source === 'custom' && !table.columns.includes(c.name));
  return [...fromTable, ...remainingCustom];
}

/** Coerce numeric-looking strings to numbers (used after CSV parsing and example editing). */
export function normalizeCell(v: unknown): Cell {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (s.trim() === '') return null;
  return isNumeric(s) ? Number(s) : s;
}
