import type { ExampleTable, FieldMeta, Program, Table } from '../types';
import { looseEqual, runProgram } from './reshape';

/** Does a candidate table contain every column and every filled example row of r7? */
export function satisfiesExample(result: Table, example: ExampleTable): boolean {
  if (!example.columns.every((c) => result.columns.includes(c))) return false;
  for (const ex of example.rows) {
    const filled = Object.entries(ex).filter(([, v]) => v.trim() !== '');
    if (filled.length === 0) continue;
    const hit = result.rows.some((r) => filled.every(([c, v]) => looseEqual(v, r[c] ?? null)));
    if (!hit) return false;
  }
  return true;
}

const lc = (s: string) => s.trim().toLowerCase();

function uniqueSets(sets: string[][]): string[][] {
  const seen = new Set<string>();
  return sets.filter((s) => {
    if (s.length === 0) return false;
    const k = JSON.stringify([...s].sort());
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function foldCandidates(table: Table, fields: FieldMeta[], example: ExampleTable, newCols: string[], existing: string[]): Program[] {
  if (newCols.length !== 2) return [];
  const out: Program[] = [];
  const typeOf = new Map(fields.map((f) => [f.name, f.type]));
  const free = table.columns.filter((c) => !existing.includes(c));
  for (const [key, value] of [newCols, [newCols[1], newCols[0]]]) {
    const named = new Set(example.rows.map((r) => lc(r[key] ?? '')).filter(Boolean));
    const minimal = free.filter((c) => named.has(lc(c)));
    const types = new Set(minimal.map((c) => typeOf.get(c)));
    const sameType = minimal.length ? free.filter((c) => types.has(typeOf.get(c))) : [];
    const quant = free.filter((c) => typeOf.get(c) === 'quantitative');
    for (const cols of uniqueSets([sameType, minimal, quant, free])) {
      out.push({ op: 'fold', columns: cols, key, value });
    }
  }
  return out;
}

function pivotCandidates(table: Table, fields: FieldMeta[], newCols: string[], existing: string[]): Program[] {
  if (newCols.length === 0) return [];
  const out: Program[] = [];
  for (const k of fields) {
    if (existing.includes(k.name)) continue;
    const distinct = [...new Set(table.rows.map((r) => String(r[k.name])))];
    if (distinct.length > 50) continue;
    const renames: Record<string, string> = {};
    let ok = true;
    for (const n of newCols) {
      const match = distinct.find((d) => lc(d) === lc(n));
      if (match === undefined) {
        ok = false;
        break;
      }
      renames[match] = n;
    }
    if (!ok) continue;
    for (const v of fields) {
      if (v.name === k.name || existing.includes(v.name)) continue;
      const allOthers = table.columns.filter((c) => c !== k.name && c !== v.name);
      for (const index of uniqueSets([existing, allOthers]).concat(existing.length ? [] : [[]])) {
        out.push({ op: 'pivot', index, key: k.name, value: v.name, renames });
      }
    }
  }
  return out;
}

/**
 * [tool_2 execute]: r1 + r6* + r3_2 + r7 -> r8*.
 * Enumerative programming-by-example over fold / pivot programs, keeping only programs
 * whose output is consistent with the user's example table. Running the kept programs
 * to produce candidate tables (r9) is the separate tool_1 execute step in the UI.
 */
export function synthesizePrograms(table: Table, fields: FieldMeta[], example: ExampleTable, limit = 6): Program[] {
  const newCols = example.columns.filter((c) => !table.columns.includes(c));
  const existing = example.columns.filter((c) => table.columns.includes(c));
  const candidates = [
    ...foldCandidates(table, fields, example, newCols, existing),
    ...pivotCandidates(table, fields, newCols, existing),
  ];
  const seen = new Set<string>();
  const result: Program[] = [];
  for (const p of candidates) {
    let t: Table;
    try {
      t = runProgram(table, p);
    } catch {
      continue;
    }
    if (!satisfiesExample(t, example)) continue;
    const sig = JSON.stringify([[...t.columns].sort(), t.rows.length, t.rows.slice(0, 20)]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    result.push(p);
    if (result.length >= limit) break;
  }
  return result;
}
