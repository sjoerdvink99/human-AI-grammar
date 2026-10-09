import type { Cell, Program, Row, Table } from '../types';

/** Render a program (r8) as readable code. */
export function programToCode(p: Program): string {
  const s = (v: unknown) => JSON.stringify(v);
  if (p.op === 'fold') {
    return `fold(table, {\n  columns: ${s(p.columns)},\n  key: ${s(p.key)},\n  value: ${s(p.value)}\n})`;
  }
  const renames = Object.entries(p.renames).filter(([a, b]) => a !== b);
  return (
    `pivot(table, {\n  index: ${s(p.index)},\n  key: ${s(p.key)},\n  value: ${s(p.value)}` +
    (renames.length ? `,\n  rename: ${s(Object.fromEntries(renames))}` : '') +
    `\n})`
  );
}

/** [tool_1 execute] for P2: run a reshaping program (r8) on r1 to get a candidate table (r9). */
export function runProgram(table: Table, p: Program): Table {
  if (p.op === 'fold') {
    const keep = table.columns.filter((c) => !p.columns.includes(c));
    const rows: Row[] = [];
    for (const r of table.rows) {
      for (const c of p.columns) {
        const out: Row = {};
        for (const k of keep) out[k] = r[k] ?? null;
        out[p.key] = c;
        out[p.value] = r[c] ?? null;
        rows.push(out);
      }
    }
    return { name: table.name, columns: [...keep, p.key, p.value], rows };
  }
  // pivot
  const groups = new Map<string, Row>();
  const newCols: string[] = [];
  for (const r of table.rows) {
    const keyVal = String(r[p.key]);
    const col = p.renames[keyVal] ?? keyVal;
    if (!newCols.includes(col)) newCols.push(col);
    const gk = JSON.stringify(p.index.map((i) => r[i] ?? null));
    let g = groups.get(gk);
    if (!g) {
      g = {};
      for (const i of p.index) g[i] = r[i] ?? null;
      groups.set(gk, g);
    }
    g[col] = r[p.value] ?? null;
  }
  const rows = [...groups.values()].map((g) => {
    for (const c of newCols) if (!(c in g)) g[c] = null;
    return g;
  });
  return { name: table.name, columns: [...p.index, ...newCols], rows };
}

/** Loose equality used to match user-typed example cells against data cells. */
export function looseEqual(typed: string, actual: Cell): boolean {
  const t = typed.trim().toLowerCase();
  if (actual === null || actual === undefined) return t === '' || t === 'null';
  const a = String(actual).trim().toLowerCase();
  if (t === a) return true;
  const tn = Number(t);
  const an = Number(a);
  if (t !== '' && !isNaN(tn) && !isNaN(an)) return Math.abs(tn - an) <= 1e-6 * Math.max(1, Math.abs(an));
  return false;
}
