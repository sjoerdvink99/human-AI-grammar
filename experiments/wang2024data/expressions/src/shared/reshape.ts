import type { Cell, ReshapeProgram, Row, Table } from './types';

/** [tool_1 execute] for reshaping_programs: run one program on the full table. */
export function runReshape(program: ReshapeProgram, table: Table): Table {
  switch (program.kind) {
    case 'identity': {
      const keep = program.keep.length ? program.keep : table.columns;
      return { columns: [...keep], rows: table.rows.map((r) => pick(r, keep)) };
    }
    case 'pivot_longer': {
      const columns = [...program.keep, program.namesTo, program.valuesTo];
      const rows: Row[] = [];
      for (const r of table.rows) {
        for (const c of program.cols) {
          rows.push({ ...pick(r, program.keep), [program.namesTo]: c, [program.valuesTo]: r[c] ?? null });
        }
      }
      return { columns, rows };
    }
    case 'pivot_wider': {
      const names: string[] = [];
      for (const r of table.rows) {
        const n = String(r[program.namesFrom]);
        if (!names.includes(n)) names.push(n);
      }
      const groups = new Map<string, Row>();
      for (const r of table.rows) {
        const key = JSON.stringify(program.idCols.map((c) => r[c]));
        let g = groups.get(key);
        if (!g) {
          g = pick(r, program.idCols);
          for (const n of names) g[n] = null;
          groups.set(key, g);
        }
        g[String(r[program.namesFrom])] = r[program.valuesFrom] ?? null;
      }
      return { columns: [...program.idCols, ...names], rows: [...groups.values()] };
    }
  }
}

function pick(r: Row, cols: string[]): Row {
  const o: Row = {};
  for (const c of cols) o[c] = r[c] ?? null;
  return o;
}

const q = (s: string) => JSON.stringify(s);
const list = (xs: string[]) => `[${xs.map(q).join(', ')}]`;

/** Readable code for a reshaping program (shown to the user as a formal artifact). */
export function programToCode(p: ReshapeProgram): string {
  switch (p.kind) {
    case 'identity':
      return `select(table, columns=${list(p.keep)})`;
    case 'pivot_longer':
      return `pivot_longer(table,\n  cols=${list(p.cols)},\n  names_to=${q(p.namesTo)},\n  values_to=${q(p.valuesTo)})`;
    case 'pivot_wider':
      return `pivot_wider(table,\n  id_cols=${list(p.idCols)},\n  names_from=${q(p.namesFrom)},\n  values_from=${q(p.valuesFrom)})`;
  }
}

export function cellEquals(a: Cell, b: Cell): boolean {
  if (a === null || b === null) return a === b;
  const na = Number(a);
  const nb = Number(b);
  if (String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(na));
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
