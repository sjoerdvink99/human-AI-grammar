// tool_1 evaluate / execute for model-generated derivation functions.
import vm from 'node:vm';
import ts from 'typescript';
import type { CodeCandidate, Row, Value } from '../shared/types';

const PREVIEW_ROWS = 8;
const TIMEOUT_MS = 1000;

/** Pull the TypeScript function out of a model reply (fenced block or bare). */
export function extractCode(reply: string): string | null {
  const fence = [...reply.matchAll(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const body = fence.find((f) => /function\s+derive\s*\(/.test(f)) ?? fence[0] ?? reply;
  return /function\s+derive\s*\(/.test(body) ? body.trim() : null;
}

/**
 * Transpile the TypeScript and run derive() over all rows inside a fresh VM
 * context. The whole loop runs in the VM so the timeout also stops endless loops.
 * (node:vm isolates globals but is not a security boundary; this is a local tool.)
 */
function runInVm(code: string, inputs: Row[]): { ok: true; value: unknown }[] | { error: string; row: number } {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    reportDiagnostics: false,
  }).outputText;
  const context = vm.createContext({ __rows: JSON.stringify(inputs) });
  const script = `${js}
;(function () {
  if (typeof derive !== 'function') return JSON.stringify({ error: 'no function named derive', row: -1 });
  var table = JSON.parse(__rows).map(function (r) { return Object.freeze(r); });
  Object.freeze(table);
  var out = [];
  for (var i = 0; i < table.length; i++) {
    try {
      var v = derive(table[i], i, table);
      if (v instanceof Date) v = isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
      else if (v !== null && v !== undefined && typeof v === 'object') return JSON.stringify({ error: 'derive returned an object, expected a string, number, or boolean', row: i });
      else if (typeof v === 'number' && !isFinite(v)) v = null;
      out.push({ ok: true, value: v === undefined ? null : v });
    } catch (e) {
      return JSON.stringify({ error: String(e && e.message ? e.message : e), row: i });
    }
  }
  return JSON.stringify(out);
})()`;
  const result = vm.runInContext(script, context, { timeout: TIMEOUT_MS * 5 });
  return JSON.parse(String(result));
}

function toValue(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  throw new Error(`derive returned a ${typeof v}, expected a string, number, or boolean`);
}

/** Run a derivation function over every row; throws on the first failing row. */
export function applyCode(code: string, rows: Row[], sources: string[]): Value[] {
  const inputs = rows.map((r) => Object.fromEntries(sources.map((s) => [s, r[s] ?? null])));
  let res;
  try {
    res = runInVm(code, inputs);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    throw new Error(/timed out/i.test(msg) ? 'derive took too long (timeout)' : msg);
  }
  if (!Array.isArray(res)) throw new Error(res.row >= 0 ? `row ${res.row + 1}: ${res.error}` : res.error);
  const out = res.map((r) => toValue(r.value));
  if (out.length > 0 && out.every((v) => v === null)) throw new Error('derive returned no values');
  return out;
}

/**
 * [tool_1 evaluate]: code_candidates* -> valid_codes* + preview_tables*.
 * A candidate is valid when it runs without errors on every row of the table.
 */
export function evaluateCandidates(
  codes: { code: string | null; prompt: number; error?: string }[],
  rows: Row[],
  sources: string[],
  newName: string,
): CodeCandidate[] {
  const seen = new Set<string>();
  const result: CodeCandidate[] = [];
  for (const c of codes) {
    if (!c.code) {
      result.push({ code: '', prompt: c.prompt, valid: false, error: c.error ?? 'model reply had no derive function' });
      continue;
    }
    const key = c.code.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const values = applyCode(c.code, rows, sources);
      const preview = rows.slice(0, PREVIEW_ROWS).map((r, i) => ({
        ...Object.fromEntries(sources.map((s) => [s, r[s] ?? null])),
        [newName]: values[i],
      }));
      result.push({ code: c.code, prompt: c.prompt, valid: true, preview });
    } catch (e) {
      result.push({ code: c.code, prompt: c.prompt, valid: false, error: (e as Error).message });
    }
  }
  return result;
}
