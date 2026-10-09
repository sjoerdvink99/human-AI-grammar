// Deterministic program edits: tool modify (processes 3, 4, 5) and tool extract (process 5).
import { evalExpr, isStringAttr, tokenizeLine, type ParamRecord, type SceneNode, type Value } from './dsl';

/**
 * Turn what a person typed into source text for a value: keep numbers, expressions over known
 * parameters and quoted strings; quote anything else.
 */
export function toRawValue(input: string, attr: string, params: ParamRecord[]): string {
  const s = input.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s;
  const env = new Map<string, Value>(params.map((p) => [p.name, p.value]));
  try {
    const v = evalExpr(s, env);
    if (!isStringAttr(attr) || typeof v === 'string' || params.some((p) => p.name === s)) return s;
  } catch {
    /* not an expression */
  }
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** tool modify (process 3): r9 {node, attr, value} applied to r3 → r3'. */
export function setAttribute(code: string, node: SceneNode, attr: string, raw: string | null): string {
  const lines = code.split('\n');
  const i = node.startLine - 1;
  const line = lines[i];
  const indent = /^\s*/.exec(line)![0];
  const tokens = tokenizeLine(line.trim()).map((t) => t.text);
  const opens = tokens[tokens.length - 1] === '{';
  const body = opens ? tokens.slice(0, -1) : tokens;
  const at = body.findIndex((t) => t.startsWith(`${attr}=`));
  if (raw === null) {
    if (at >= 0) body.splice(at, 1);
  } else if (at >= 0) body[at] = `${attr}=${raw}`;
  else body.push(`${attr}=${raw}`);
  lines[i] = indent + [...body, ...(opens ? ['{'] : [])].join(' ');
  return lines.join('\n');
}

/** tool modify (process 4): r11 {param, value} applied to r3 → r3'. */
export function setParam(code: string, param: ParamRecord, raw: string): string {
  const lines = code.split('\n');
  const i = param.line - 1;
  const indent = /^\s*/.exec(lines[i])![0];
  const range = param.min !== undefined && param.max !== undefined ? ` [${param.min}, ${param.max}]` : '';
  lines[i] = `${indent}param ${param.name} = ${raw}${range}`;
  return lines.join('\n');
}

/** tool extract (process 5): r3 + r12 → r14 (the selected element's source lines, dedented). */
export function extractSnippet(code: string, startLine: number, endLine: number): string {
  const lines = code.split('\n').slice(startLine - 1, endLine);
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

/** tool modify (process 5): splice the edited snippet r14' back into r3 → r3'. */
export function spliceSnippet(code: string, startLine: number, endLine: number, snippet: string): string {
  const lines = code.split('\n');
  const indent = /^\s*/.exec(lines[startLine - 1] ?? '')![0];
  const replacement = snippet
    .replace(/\s+$/, '')
    .split('\n')
    .map((l) => (l.trim() ? indent + l : l));
  lines.splice(startLine - 1, endLine - startLine + 1, ...replacement);
  return lines.join('\n');
}
