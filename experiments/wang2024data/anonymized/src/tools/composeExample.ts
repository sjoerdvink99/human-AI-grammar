import type { Encoding, ExampleTable, Table } from '../types';

/**
 * [tool_1 compose]: r1 + r6* + r3_2 -> r7.
 * Columns are the fields placed on the encoding shelves. Existing fields are prefilled with
 * distinct values from the data; new-concept cells are left empty for the user to fill.
 */
export function composeExampleTable(table: Table, encoding: Encoding, nRows = 3): ExampleTable {
  const columns = [...new Set(Object.values(encoding.channels).filter((v): v is string => !!v))];
  const existing = columns.filter((c) => table.columns.includes(c));
  const rows: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const r of table.rows) {
    if (rows.length >= nRows) break;
    const key = JSON.stringify(existing.map((c) => r[c]));
    if (existing.length && seen.has(key)) continue;
    seen.add(key);
    const row: Record<string, string> = {};
    for (const c of columns) row[c] = existing.includes(c) ? String(r[c] ?? '') : '';
    rows.push(row);
  }
  while (rows.length < nRows) rows.push(Object.fromEntries(columns.map((c) => [c, ''])));
  return { columns, rows };
}
