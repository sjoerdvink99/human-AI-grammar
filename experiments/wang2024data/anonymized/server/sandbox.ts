import vm from 'node:vm';
import type { Cell, CodeCandidate, EvaluatedCandidate, FieldType, Row, Table } from '../src/types';
import { inferType } from '../src/tools/extract';

/** Run a `function derive(row, index, table)` over every row in an isolated context. */
export function runDerive(code: string, table: Table): Cell[] {
  const rows = JSON.parse(JSON.stringify(table.rows)) as Row[];
  const ctx = vm.createContext({ __rows: rows, Math, JSON, Number, String, Boolean, Array, Object, isNaN, isFinite, parseFloat, parseInt, Date });
  const src = `${code}\n;(function(){ const out = []; for (let i = 0; i < __rows.length; i++) { out.push(derive({ ...__rows[i] }, i, __rows)); } return JSON.stringify(out); })()`;
  const json = vm.runInContext(src, ctx, { timeout: 2000 }) as string;
  const values = JSON.parse(json) as unknown[];
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    return JSON.stringify(v);
  });
}

/**
 * [tool_1 evaluate]: r13* -> r14* + r15*.
 * Runs each candidate on the table, drops candidates that throw or return no values,
 * merges candidates with identical output, and builds a preview table per candidate.
 */
export function evaluateCandidates(
  candidates: CodeCandidate[],
  table: Table,
  name: string,
  sourceFields: string[],
  previewRows = 8,
): { evaluated: EvaluatedCandidate[]; rejected: { id: string; error: string }[] } {
  const evaluated: EvaluatedCandidate[] = [];
  const rejected: { id: string; error: string }[] = [];
  const seen = new Map<string, string>();
  for (const c of candidates) {
    let values: Cell[];
    try {
      values = runDerive(c.code, table);
    } catch (e) {
      rejected.push({ id: c.id, error: (e as Error).message });
      continue;
    }
    const nullCount = values.filter((v) => v === null).length;
    if (nullCount === values.length) {
      rejected.push({ id: c.id, error: 'returned null for every row' });
      continue;
    }
    const sig = JSON.stringify(values);
    if (seen.has(sig)) {
      rejected.push({ id: c.id, error: `same output as ${seen.get(sig)}` });
      continue;
    }
    seen.set(sig, c.id);
    const src = sourceFields.length ? sourceFields.filter((f) => f !== name) : table.columns.filter((f) => f !== name);
    const columns = [...src, name];
    const preview: Table = {
      name,
      columns,
      rows: table.rows.slice(0, previewRows).map((r, i) => ({ ...Object.fromEntries(src.map((s) => [s, r[s] ?? null])), [name]: values[i] })),
    };
    const outputType: FieldType = inferType(values);
    evaluated.push({ ...c, preview, outputType, nullCount });
  }
  return { evaluated, rejected };
}

/** [tool_1 execute] for P3/P4: r1 + r16 -> r1' with the derived column added or replaced. */
export function applyDerivation(code: string, table: Table, name: string): Table {
  const values = runDerive(code, table);
  const columns = table.columns.includes(name) ? table.columns : [...table.columns, name];
  return { ...table, columns, rows: table.rows.map((r, i) => ({ ...r, [name]: values[i] })) };
}
