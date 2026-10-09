import { inferType } from './concepts';
import { cellEquals, runReshape } from './reshape';
import { specFields } from './translate';
import type { ChartSpec, ReshapeProgram, Row, Table } from './types';

/**
 * [tool_1 compose]: table + custom_concepts + chart_spec -> example_relation_1.
 * Columns are the chart_spec's fields; fields that exist in the table are
 * prefilled from the first table row, custom concepts are left blank for the user.
 */
export function composeExampleRelation(spec: ChartSpec, table: Table, nRows = 2): Table {
  const columns = specFields(spec);
  const first = table.rows[0] ?? {};
  const rows: Row[] = Array.from({ length: nRows }, () => {
    const r: Row = {};
    for (const c of columns) r[c] = table.columns.includes(c) ? first[c] ?? null : null;
    return r;
  });
  return { columns, rows };
}

/** True when every filled example cell is matched by one row of the output. */
export function isConsistent(output: Table, example: Table): boolean {
  if (!example.columns.every((c) => output.columns.includes(c))) return false;
  return example.rows.every((er) => {
    const filled = example.columns.filter((c) => er[c] !== null && er[c] !== '');
    if (filled.length === 0) return true;
    return output.rows.some((or) => filled.every((c) => cellEquals(or[c], er[c])));
  });
}

export interface SynthesisResult {
  programs: ReshapeProgram[];
  message?: string;
}

const MAX_PROGRAMS = 6;

/**
 * [tool_2 execute]: table + example_relation_2 -> reshaping_programs_1*.
 * Enumerative programming-by-example over a small reshaping DSL
 * (select, pivot_longer, pivot_wider). Returns programs whose output on the
 * full table is consistent with the example, deduplicated by output.
 */
export function synthesizeReshapes(table: Table, example: Table): SynthesisResult {
  const fields = example.columns;
  const existing = fields.filter((f) => table.columns.includes(f));
  const customs = fields.filter((f) => !table.columns.includes(f));

  const customFilled = example.rows.some((r) => customs.some((c) => r[c] !== null && r[c] !== ''));
  if (customs.length > 0 && !customFilled) {
    return { programs: [], message: 'Fill in at least one value for the new concepts in the example.' };
  }

  const candidates: ReshapeProgram[] = [];
  if (customs.length === 0) candidates.push({ kind: 'identity', keep: [...table.columns] });

  // pivot_longer: one custom concept takes column names, the other takes the values.
  const pairs: [string, string][] = [];
  for (const n of customs) for (const v of customs) if (n !== v) pairs.push([n, v]);
  if (customs.length === 1) {
    pairs.push([customs[0], uniqueName('value', table.columns)]);
    pairs.push([uniqueName('variable', table.columns), customs[0]]);
  }
  for (const [namesTo, valuesTo] of pairs) {
    for (const cols of pivotLongerColumnChoices(table, example, namesTo, existing)) {
      if (cols.length < 1) continue;
      const keep = table.columns.filter((c) => !cols.includes(c));
      candidates.push({ kind: 'pivot_longer', cols, namesTo, valuesTo, keep });
    }
  }

  // pivot_wider: custom concept names are values of some column.
  if (customs.length > 0) {
    for (const namesFrom of table.columns) {
      const distinct = new Set(table.rows.map((r) => String(r[namesFrom])));
      const covered = customs.filter((c) => distinct.has(c));
      if (covered.length === 0 || covered.length < customs.length) continue;
      for (const valuesFrom of table.columns) {
        if (valuesFrom === namesFrom) continue;
        const rest = table.columns.filter((c) => c !== namesFrom && c !== valuesFrom);
        const idChoices = dedupeLists([existing.filter((c) => rest.includes(c)), rest]);
        for (const idCols of idChoices) candidates.push({ kind: 'pivot_wider', namesFrom, valuesFrom, idCols });
      }
    }
  }

  const seen = new Set<string>();
  const programs: ReshapeProgram[] = [];
  for (const p of candidates) {
    let out: Table;
    try {
      out = runReshape(p, table);
    } catch {
      continue;
    }
    if (!isConsistent(out, example)) continue;
    const sig = signature(out, fields);
    if (seen.has(sig)) continue;
    seen.add(sig);
    programs.push(p);
    if (programs.length >= MAX_PROGRAMS) break;
  }
  return {
    programs,
    message: programs.length
      ? undefined
      : 'No reshaping program matches this example. Check the example values, or derive the concept instead.',
  };
}

function pivotLongerColumnChoices(table: Table, example: Table, namesTo: string, existing: string[]): string[][] {
  const named = new Set<string>();
  if (example.columns.includes(namesTo)) {
    for (const r of example.rows) {
      const v = r[namesTo];
      if (v === null || v === '') continue;
      const col = table.columns.find((c) => cellEquals(c, v));
      if (!col) return []; // example names something that is not a column: pivot_longer cannot produce it
      named.add(col);
    }
  }
  const namedCols = table.columns.filter((c) => named.has(c));
  const free = table.columns.filter((c) => !existing.includes(c));
  const typeOf = (c: string) => inferType(table.rows.map((r) => r[c]));
  const refType = namedCols.length ? typeOf(namedCols[0]) : 'quantitative';
  const sameType = free.filter((c) => typeOf(c) === refType);
  const choices = [namedCols, sameType, free].filter((cs) => namedCols.every((n) => cs.includes(n)));
  // Prefer wider choices first: users usually show two of many columns.
  return dedupeLists([choices[1], choices[2], choices[0]].filter(Boolean) as string[][]);
}

function dedupeLists(lists: string[][]): string[][] {
  const seen = new Set<string>();
  return lists.filter((l) => {
    const k = JSON.stringify(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function uniqueName(base: string, taken: string[]): string {
  let n = base;
  let i = 1;
  while (taken.includes(n)) n = `${base}_${i++}`;
  return n;
}

function signature(t: Table, fields: string[]): string {
  return JSON.stringify([t.rows.length, t.rows.slice(0, 50).map((r) => fields.map((f) => r[f]))]);
}
