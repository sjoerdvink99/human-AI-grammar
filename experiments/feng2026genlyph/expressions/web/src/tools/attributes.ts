import type { Attributes, Attribute, Dataset, Cell } from '../types';

/** Minimal RFC-4180 CSV parser. */
export function parseCsv(text: string, name = 'dataset'): Dataset {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) records.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) records.push(row);
  if (records.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const columns = records[0].map((c, i) => c.trim() || `col${i + 1}`);
  const rows = records.slice(1).map((r) => {
    const o: Record<string, Cell> = {};
    columns.forEach((c, i) => {
      const v = (r[i] ?? '').trim();
      o[c] = v !== '' && !isNaN(Number(v)) ? Number(v) : v;
    });
    return o;
  });
  return { name, columns, rows };
}

/** [tool_1 extract] dataset_1 -> attributes_1 */
export function extractAttributes(ds: Dataset): Attributes {
  return ds.columns.map((name): Attribute => {
    const vals = ds.rows.map((r) => r[name]).filter((v) => v !== '');
    const numeric = vals.length > 0 && vals.every((v) => typeof v === 'number');
    if (numeric) {
      const nums = vals as number[];
      return { name, kind: 'numeric', min: Math.min(...nums), max: Math.max(...nums) };
    }
    const cats = [...new Set(vals.map(String))];
    if (cats.length === ds.rows.length && cats.length > 12) return { name, kind: 'id', categories: [] };
    if (cats.length === ds.rows.length && ds.rows.length > 8) return { name, kind: 'id', categories: [] };
    return { name, kind: 'categorical', categories: cats.sort() };
  });
}

/** [tool_1 translate] attributes_1 -> dataset_description_1 */
export function describeDataset(ds: Dataset, attrs: Attributes): string {
  const lines = [
    `Dataset "${ds.name}" with ${ds.rows.length} rows and ${attrs.length} columns.`,
    'Columns:',
    ...attrs.map((a) =>
      a.kind === 'numeric'
        ? `- ${a.name}: numeric, range ${a.min} to ${a.max}`
        : a.kind === 'categorical'
          ? `- ${a.name}: categorical with values ${a.categories!.join(', ')}`
          : `- ${a.name}: identifier/name (e.g. ${ds.rows.slice(0, 5).map((r) => r[a.name]).join(', ')})`,
    ),
    'Sample rows:',
    ...ds.rows.slice(0, 5).map((r) => '- ' + ds.columns.map((c) => `${c}=${r[c]}`).join('; ')),
  ];
  return lines.join('\n');
}
