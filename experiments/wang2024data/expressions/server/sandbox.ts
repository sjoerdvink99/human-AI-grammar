import vm from 'node:vm';
import type { Cell, CodeCandidate, DerivationRequest, Table } from '../src/shared/types.ts';
import { normalizeCell } from '../src/shared/concepts.ts';

const TIMEOUT_MS = 1000;
const PREVIEW_ROWS = 8;

/**
 * Run a derivation function `function derive(row, index, table)` over every row.
 * node:vm with a timeout keeps runaway code from blocking the server; it is not
 * a security boundary, which is acceptable for this local, single-user tool.
 */
export function runDerivation(code: string, table: Table): Cell[] {
  const context = vm.createContext({ __table: JSON.parse(JSON.stringify(table)), Math, JSON, Number, String, Date, Array, Object, isNaN, isFinite, parseFloat, parseInt });
  const script = new vm.Script(
    `${code}\n;(function(){ if (typeof derive !== 'function') throw new Error('code must define function derive(row, index, table)');
      return __table.rows.map(function(r, i){ return derive(r, i, __table); }); })()`,
  );
  const raw = script.runInContext(context, { timeout: TIMEOUT_MS }) as unknown[];
  return Array.from(raw, (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' || typeof v === 'boolean') return normalizeCell(v);
    if (v instanceof Date) return v.toISOString();
    if (Object.prototype.toString.call(v) === '[object Date]') return (v as Date).toISOString();
    throw new Error(`derive returned a non-primitive value (${typeof v})`);
  });
}

/** [tool_1 execute]: table + selected_code -> table with the derived column (added or replaced). */
export function applyDerivation(code: string, table: Table, name: string): Table {
  const values = runDerivation(code, table);
  const columns = table.columns.includes(name) ? [...table.columns] : [...table.columns, name];
  return { columns, rows: table.rows.map((r, i) => ({ ...r, [name]: values[i] })) };
}

/**
 * [tool_1 evaluate]: code_candidates* -> valid_codes* + preview_tables*.
 * A candidate is valid when it defines derive(), runs on every row within the
 * time limit, returns primitive values, and does not return only nulls.
 * Candidates with identical output to an earlier valid one are marked duplicates.
 */
export function evaluateCandidates(
  codes: { code: string; prompt: number; error?: string }[],
  table: Table,
  request: DerivationRequest,
): CodeCandidate[] {
  const seen = new Set<string>();
  const sourceCols = request.sourceConcepts.filter((c) => table.columns.includes(c) && c !== request.name);
  return codes.map(({ code, prompt, error }) => {
    if (error) return { code, prompt, valid: false, error };
    try {
      const values = runDerivation(code, table);
      if (values.every((v) => v === null)) return { code, prompt, valid: false, error: 'returned no values (all null)' };
      const signature = JSON.stringify(values);
      if (seen.has(signature)) return { code, prompt, valid: false, error: 'same output as an earlier candidate', signature };
      seen.add(signature);
      const preview: Table = {
        columns: [...sourceCols, request.name],
        rows: table.rows.slice(0, PREVIEW_ROWS).map((r, i) => {
          const o: Record<string, Cell> = {};
          for (const c of sourceCols) o[c] = r[c] ?? null;
          o[request.name] = values[i];
          return o;
        }),
      };
      return { code, prompt, valid: true, preview, signature };
    } catch (e) {
      return { code, prompt, valid: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
