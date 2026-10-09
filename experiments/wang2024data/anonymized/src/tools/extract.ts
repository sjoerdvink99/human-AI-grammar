import type { Cell, FieldMeta, FieldType, Table } from '../types';

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2})?)?$/;

export function inferType(values: Cell[]): FieldType {
  const present = values.filter((v) => v !== null && v !== '');
  if (present.length === 0) return 'nominal';
  if (present.every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))))) {
    return 'quantitative';
  }
  if (present.every((v) => typeof v === 'string' && DATE_RE.test(v))) return 'temporal';
  return 'nominal';
}

/** [tool_1 extract]: r1 -> r2*. One metadata record per column. */
export function extractFields(table: Table): FieldMeta[] {
  return table.columns.map((name) => ({
    name,
    type: inferType(table.rows.map((r) => r[name] ?? null)),
    source: 'original' as const,
  }));
}

/**
 * [tool_1 assign]: after a table change, re-derive r2 from the new table while keeping
 * the provenance of fields that already existed, and marking newly appearing columns
 * with the given source (e.g. 'reshaped' for P2 concepts).
 */
export function assignFields(
  table: Table,
  previous: FieldMeta[],
  newSource: 'reshaped' | 'derived' | 'original' = 'reshaped',
): FieldMeta[] {
  const prev = new Map(previous.map((f) => [f.name, f]));
  return extractFields(table).map((f) => {
    const old = prev.get(f.name);
    if (old) return { ...old, type: f.type };
    return { ...f, source: newSource };
  });
}

/** Coerce cell values in a column so that quantitative fields hold numbers. */
export function normalizeTable(table: Table): Table {
  const fields = extractFields(table);
  const quant = new Set(fields.filter((f) => f.type === 'quantitative').map((f) => f.name));
  return {
    ...table,
    rows: table.rows.map((r) => {
      const out: Record<string, Cell> = {};
      for (const c of table.columns) {
        const v = r[c] ?? null;
        out[c] = quant.has(c) && v !== null && v !== '' ? Number(v) : v;
      }
      return out;
    }),
  };
}
