// Process 3/4: tool_1 compose (llm_prompts*) and model generate (code_candidates*).
import type { ConceptType, DerivationRequest, Row, Value } from '../shared/types';
import { callModel } from './model';
import { extractCode } from './evaluate';

export const PROMPT_VARIANTS = 3;

export const SYSTEM_PROMPT = [
  'You write a single TypeScript function that computes a new data column from existing columns of a table.',
  'Reply with exactly one ```typescript code block containing a function named `derive` and nothing else.',
  'Signature: function derive(row: Row, index: number, table: Row[]): string | number | boolean | null',
  'Use only plain TypeScript and built-ins (Math, Date, String, Number, Array). No imports, no I/O, no external libraries.',
  'Return null when a value cannot be computed for a row. Never throw for missing or malformed values.',
].join('\n');

const TS_TYPE: Record<ConceptType, string> = {
  quantitative: 'number | null',
  nominal: 'string | null',
  ordinal: 'string | null',
  temporal: 'string | null /* date string */',
};

function sampleRows(rows: Row[], sources: string[], variant: number): Row[] {
  const n = Math.min(rows.length, 6);
  if (variant === 0 || rows.length <= n) return rows.slice(0, n).map((r) => pick(r, sources));
  // spread the sample over the whole table
  const step = rows.length / n;
  const off = variant === 1 ? 0 : Math.floor(step / 2);
  return Array.from({ length: n }, (_, i) => pick(rows[Math.min(rows.length - 1, Math.floor(i * step) + off)], sources));
}

function pick(r: Row, cols: string[]): Row {
  return Object.fromEntries(cols.map((c) => [c, r[c] ?? null]));
}

const EMPHASIS = [
  'Compute exactly what the description asks, as simply as possible.',
  'Read the description literally; if it refers to other rows (ranks, shares, running totals, differences), use `table`.',
  'Be defensive about formats: parse numbers and dates robustly and normalise text before comparing.',
];

/**
 * [tool_1 compose]: table + concepts + derivation_request -> llm_prompts*.
 * Each prompt is a contextualised TypeScript stub: a Row type built from the
 * source concepts, sample rows, and the description as a doc comment.
 */
export function composePrompts(
  req: DerivationRequest,
  rows: Row[],
  types: Record<string, ConceptType>,
): string[] {
  const typeDecl = [
    'type Row = {',
    ...req.sources.map((s) => `  ${JSON.stringify(s)}: ${TS_TYPE[types[s] ?? 'nominal']};`),
    '};',
  ].join('\n');
  return Array.from({ length: PROMPT_VARIANTS }, (_, v) => {
    const samples = sampleRows(rows, req.sources, v);
    return [
      '```typescript',
      typeDecl,
      '',
      `// The table has ${rows.length} rows. Example rows:`,
      ...samples.map((r) => `// ${JSON.stringify(r)}`),
      '',
      '/**',
      ` * New column: ${JSON.stringify(req.name)}`,
      ` * Computed from: ${req.sources.map((s) => JSON.stringify(s)).join(', ')}`,
      ` * Description: ${req.description.replace(/\*\//g, '* /')}`,
      ` * Note: ${EMPHASIS[v % EMPHASIS.length]}`,
      ' */',
      'function derive(row: Row, index: number, table: Row[]): string | number | boolean | null {',
      '  // complete this function',
      '}',
      '```',
    ].join('\n');
  });
}

/** [model generate]~: llm_prompts* -> code_candidates*. One model call per prompt, in parallel. */
export async function generateCandidates(
  prompts: string[],
): Promise<{ code: string | null; prompt: number; error?: string }[]> {
  return Promise.all(
    prompts.map(async (prompt, i) => {
      try {
        const reply = await callModel({ system: SYSTEM_PROMPT, prompt });
        return { code: extractCode(reply), prompt: i };
      } catch (e) {
        return { code: null, prompt: i, error: (e as Error).message };
      }
    }),
  );
}

export type { Value };
