import type { DeriveRequest, FieldMeta, Row, Table } from '../types';

const VARIANT_HINTS = [
  'Write the most direct implementation.',
  'Handle missing, empty or malformed inputs gracefully by returning null.',
  'Think about alternative interpretations of the description and implement the most plausible one, explaining your interpretation in a short comment.',
];

function sampleRows(rows: Row[], variant: number, n = 5): Row[] {
  if (rows.length <= n) return rows;
  if (variant === 0) return rows.slice(0, n);
  if (variant === 1) return rows.slice(-n);
  const step = Math.floor(rows.length / n);
  return Array.from({ length: n }, (_, i) => rows[i * step]);
}

function jsType(t: FieldMeta['type']): string {
  return t === 'quantitative' ? 'number' : 'string';
}

/**
 * [tool_1 compose]: r1 + r2* + r11 -> r12*.
 * Each prompt is a code skeleton: a JS function signature with a doc comment describing
 * the concept, typed parameters taken from the source fields, and sample rows.
 */
export function composePrompts(table: Table, fields: FieldMeta[], req: DeriveRequest, k = 3): string[] {
  const src = req.sourceFields.length ? req.sourceFields : table.columns;
  const meta = src.map((n) => fields.find((f) => f.name === n)).filter((f): f is FieldMeta => !!f);
  const prompts: string[] = [];
  for (let v = 0; v < k; v++) {
    const rows = sampleRows(table.rows, v).map((r) => Object.fromEntries(src.map((c) => [c, r[c] ?? null])));
    prompts.push(
      `// Complete the JavaScript function below. It computes a new data field for ONE table row.
// Respond with only the completed function in a single \`\`\`javascript code block.
// No imports, no external calls, no Date.now()/Math.random(). Return null when the value cannot be computed.
// ${VARIANT_HINTS[v % VARIANT_HINTS.length]}

// Table "${table.name}" has ${table.rows.length} rows. Sample rows (source fields only):
${rows.map((r) => '//   ' + JSON.stringify(r)).join('\n')}

/**
 * New field: ${JSON.stringify(req.name)}
 * Description: ${req.description.replace(/\*\//g, '* /')}
 *
 * @param {object} row - one row of the table with these fields:
${meta.map((f) => ` *   row[${JSON.stringify(f.name)}]: ${jsType(f.type)} (${f.type})`).join('\n')}
 * @param {number} index - position of the row in the table
 * @param {object[]} table - all rows (only for computations that need other rows, e.g. ranks or shares)
 * @returns {number|string|boolean|null} the value of ${JSON.stringify(req.name)} for this row
 */
function derive(row, index, table) {
  // TODO
}`,
    );
  }
  return prompts;
}
