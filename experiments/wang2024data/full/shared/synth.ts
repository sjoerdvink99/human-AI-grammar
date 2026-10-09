// tool_2: an enumerative programming-by-example synthesizer for table reshaping,
// plus the tool_1 steps around it (compose example_relation, execute programs).
import type { ChartSpec, Concept, ExampleRelation, Program, ReshapeCandidate, Row, Table, Value } from './types';
import { columnValues, inferType } from './concepts';
import { specFields } from './vega';

const MAX_CANDIDATES = 6;

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * [tool_1 compose]: chart_spec + custom concepts -> example_relation.
 * One column per chart concept. Custom concept cells are seeded with the user's
 * example values; existing concept cells in the first row are seeded from the
 * table's first row so the user only has to fill in what relates them.
 */
export function composeExampleRelation(table: Table, spec: ChartSpec, concepts: Concept[]): ExampleRelation {
  const columns = specFields(spec);
  const custom = columns.map((c) => concepts.find((k) => k.name === c && k.source === 'custom'));
  const nRows = Math.max(2, ...custom.map((c) => c?.examples?.length ?? 0));
  const first = table.rows[0] ?? {};
  const rows: string[][] = [];
  for (let i = 0; i < nRows; i++) {
    rows.push(
      columns.map((col, j) => {
        const cc = custom[j];
        if (cc) return cc.examples?.[i] ?? '';
        return i === 0 && first[col] !== undefined && first[col] !== null ? String(first[col]) : '';
      }),
    );
  }
  return { columns, rows };
}

function cellMatches(expected: string, actual: Value): boolean {
  const e = expected.trim();
  if (e === '') return true;
  if (actual === null || actual === undefined) return false;
  const en = Number(e);
  if (!Number.isNaN(en) && typeof actual === 'number') return Math.abs(en - actual) < 1e-6 * Math.max(1, Math.abs(en));
  return norm(e) === norm(actual);
}

/** A program is consistent if every non-empty example row appears in its output. */
export function consistent(rel: ExampleRelation, out: { columns: string[]; rows: Row[] }): boolean {
  if (!rel.columns.every((c) => out.columns.includes(c))) return false;
  const examples = rel.rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (examples.length === 0) return false;
  return examples.every((ex) =>
    out.rows.some((row) => rel.columns.every((col, j) => cellMatches(ex[j], row[col]))),
  );
}

/** [tool_1 execute]: run a reshaping program on a table. */
export function runProgram(p: Program, table: { columns: string[]; rows: Row[] }): { columns: string[]; rows: Row[] } {
  if (p.op === 'rename') {
    const columns = [...p.keep, ...Object.values(p.mapping)];
    const rows = table.rows.map((r) => {
      const o: Row = {};
      for (const k of p.keep) o[k] = r[k] ?? null;
      for (const [from, to] of Object.entries(p.mapping)) o[to] = r[from] ?? null;
      return o;
    });
    return { columns, rows };
  }
  if (p.op === 'fold') {
    const columns = [...p.keep, p.key, p.value];
    const rows: Row[] = [];
    for (const r of table.rows) {
      for (const c of p.columns) {
        const o: Row = {};
        for (const k of p.keep) o[k] = r[k] ?? null;
        o[p.key] = p.labels[c] ?? c;
        o[p.value] = r[c] ?? null;
        rows.push(o);
      }
    }
    return { columns, rows };
  }
  // pivot
  const newCols = [...new Set(table.rows.map((r) => String(r[p.keyColumn])))].map((k) => p.mapping[k] ?? k);
  const groups = new Map<string, Row>();
  for (const r of table.rows) {
    const key = JSON.stringify(p.index.map((i) => r[i] ?? null));
    let g = groups.get(key);
    if (!g) {
      g = {};
      for (const i of p.index) g[i] = r[i] ?? null;
      for (const c of newCols) g[c] = null;
      groups.set(key, g);
    }
    const k = String(r[p.keyColumn]);
    const col = p.mapping[k] ?? k;
    if (g[col] === null) g[col] = r[p.valueColumn] ?? null;
  }
  return { columns: [...p.index, ...newCols], rows: [...groups.values()] };
}

const q = (s: string) => JSON.stringify(s);

/** Pretty-print a program as readable code (reshaping_programs are formal). */
export function programToCode(p: Program): string {
  if (p.op === 'rename') {
    const m = Object.entries(p.mapping).map(([a, b]) => `${q(a)}: ${q(b)}`).join(', ');
    return `rename(table, { ${m} })`;
  }
  if (p.op === 'fold') {
    const labels = Object.entries(p.labels)
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => `    ${q(a)}: ${q(b)}`);
    return [
      `fold(table,`,
      `  columns: [${p.columns.map(q).join(', ')}],`,
      `  key: ${q(p.key)}, value: ${q(p.value)},`,
      labels.length ? `  labels: {\n${labels.join(',\n')}\n  }` : `  labels: column names`,
      `)`,
    ].join('\n');
  }
  const m = Object.entries(p.mapping).map(([a, b]) => `${q(a)}: ${q(b)}`).join(', ');
  return [
    `pivot(table,`,
    `  index: [${p.index.map(q).join(', ')}],`,
    `  columnsFrom: ${q(p.keyColumn)}, valuesFrom: ${q(p.valueColumn)},`,
    `  rename: { ${m} }`,
    `)`,
  ].join('\n');
}

/** Strip the longest common prefix/suffix (on word boundaries) from column names. */
export function stripAffixes(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (names.length < 2) {
    for (const n of names) out[n] = n;
    return out;
  }
  const tok = names.map((n) => n.split(/(?<=[\s_\-.])/));
  let pre = 0;
  while (tok.every((t) => t.length > pre + 1 && t[pre] === tok[0][pre])) pre++;
  let suf = 0;
  while (tok.every((t) => t.length > pre + suf + 1 && t[t.length - 1 - suf] === tok[0][tok[0].length - 1 - suf])) suf++;
  names.forEach((n, i) => {
    const s = tok[i].slice(pre, tok[i].length - suf).join('').replace(/[\s_\-.]+$/, '').trim();
    out[n] = s || n;
  });
  return out;
}

function nameMatches(colName: string, example: string): boolean {
  const a = norm(colName);
  const b = norm(example);
  return b !== '' && (a === b || a.includes(b) || b.includes(a));
}

function* subsetsByType(cols: string[], table: Table): Generator<string[]> {
  const byType = new Map<string, string[]>();
  for (const c of cols) {
    const t = inferType(columnValues(table.rows, c));
    byType.set(t, [...(byType.get(t) ?? []), c]);
  }
  for (const group of byType.values()) yield group;
  yield cols;
}

/**
 * [tool_2 execute]: table + chart_spec + example_relation -> reshaping_programs*.
 * Enumerates programs of the DSL {rename, fold, pivot} in order of size and keeps
 * those whose output contains every example row.
 */
export function synthesize(table: Table, spec: ChartSpec, rel: ExampleRelation): Program[] {
  const fields = specFields(spec);
  const existing = fields.filter((f) => table.columns.includes(f));
  const custom = fields.filter((f) => !table.columns.includes(f));
  const free = table.columns.filter((c) => !existing.includes(c));
  const examplesOf = (c: string) => {
    const j = rel.columns.indexOf(c);
    return j < 0 ? [] : rel.rows.map((r) => r[j]).filter((v) => v.trim() !== '');
  };

  const found: Program[] = [];
  const seen = new Set<string>();
  const tryProgram = (p: Program) => {
    if (found.length >= MAX_CANDIDATES) return;
    const key = JSON.stringify(p);
    if (seen.has(key)) return;
    seen.add(key);
    try {
      if (consistent(rel, runProgram(p, table))) found.push(p);
    } catch {
      /* inconsistent program */
    }
  };

  if (custom.length === 0) return [];

  // Size 1: rename each custom concept to an existing column.
  if (custom.length <= 3) {
    const assign = (i: number, mapping: Record<string, string>) => {
      if (i === custom.length) {
        const used = Object.keys(mapping);
        tryProgram({ op: 'rename', mapping: { ...mapping }, keep: table.columns.filter((c) => !used.includes(c)) });
        return;
      }
      for (const col of free) {
        if (col in mapping) continue;
        assign(i + 1, { ...mapping, [col]: custom[i] });
      }
    };
    assign(0, {});
  }

  // Size 2: fold (wide -> long), custom = {key, value}.
  if (custom.length === 2) {
    for (const [key, value] of [custom, [custom[1], custom[0]]]) {
      const keyExamples = examplesOf(key);
      const matched = free.filter((c) => keyExamples.some((e) => nameMatches(c, e)));
      const sets: string[][] = [];
      if (matched.length >= 1) {
        const t = inferType(columnValues(table.rows, matched[0]));
        sets.push(free.filter((c) => inferType(columnValues(table.rows, c)) === t));
        sets.push(matched);
      }
      for (const s of subsetsByType(free, table)) sets.push(s);
      for (const cols of sets) {
        if (cols.length < 2) continue;
        const keep = table.columns.filter((c) => !cols.includes(c));
        const stripped = stripAffixes(cols);
        const byExample: Record<string, string> = {};
        for (const c of cols) byExample[c] = keyExamples.find((e) => nameMatches(c, e)) ?? stripped[c];
        const raw = Object.fromEntries(cols.map((c) => [c, c]));
        for (const labels of [byExample, stripped, raw]) {
          tryProgram({ op: 'fold', columns: cols, key, value, labels, keep });
        }
      }
    }
  }

  // Size 2: pivot (long -> wide), custom concepts named after values of a key column.
  for (const keyColumn of free) {
    const values = [...new Set(columnValues(table.rows, keyColumn).map((v) => String(v)))];
    if (values.length > 50) continue;
    const mapping: Record<string, string> = {};
    for (const c of custom) {
      const v = values.find((x) => norm(x) === norm(c)) ?? values.find((x) => nameMatches(x, c));
      if (v !== undefined) mapping[v] = c;
    }
    if (Object.keys(mapping).length !== custom.length) continue;
    for (const valueColumn of free) {
      if (valueColumn === keyColumn) continue;
      const rest = table.columns.filter((c) => c !== keyColumn && c !== valueColumn && !existing.includes(c));
      // index: the chart's existing concepts; if that is not enough, every remaining column
      for (const index of [existing, [...existing, ...rest]]) {
        if (index.length > 0) tryProgram({ op: 'pivot', keyColumn, valueColumn, mapping, index });
      }
    }
  }

  return found;
}

/** tool_2 then tool_1 execute: programs and their candidate tables. */
export function reshape(table: Table, spec: ChartSpec, rel: ExampleRelation): ReshapeCandidate[] {
  return synthesize(table, spec, rel).map((program) => ({
    program,
    code: programToCode(program),
    table: runProgram(program, table),
  }));
}
