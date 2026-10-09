import { callModel } from './model.ts';
import type { Concept, DerivationRequest, Table } from '../src/shared/types.ts';

export const DERIVE_SYSTEM = `You write small, pure JavaScript functions that derive one new data column from a table.
Reply with exactly one fenced \`\`\`javascript code block and nothing else.
The block must define: function derive(row, index, table) { ... return value; }
- row is an object mapping column names to values (numbers, strings, booleans or null).
- index is the row position; table is { columns, rows } for whole-table computations.
- Return a single number, string, boolean or null. Do not use require, import, fetch, or I/O.`;

/** Strategies that make the prompts differ, so the candidates cover different readings of the request. */
const VARIANTS = [
  'Write the most direct, literal implementation of the description.',
  'Be robust: handle missing, empty, or non-numeric values by returning null, and parse strings into numbers or dates where needed.',
  'Consider whether the description depends on other rows (for example ranks, shares of a total, differences from a previous row, or averages per group); if so compute it from table.rows, otherwise keep it per-row.',
];

/**
 * [tool_1 compose]: table + concepts + derivation_request -> llm_prompts*.
 * Built only from those three representations.
 */
export function composeDerivationPrompts(request: DerivationRequest, table: Table, concepts: Concept[], n = VARIANTS.length): string[] {
  const sources = request.sourceConcepts.filter((c) => table.columns.includes(c));
  const sampleCols = sources.length ? sources : table.columns;
  const sample = table.rows.slice(0, 6).map((r) => Object.fromEntries(sampleCols.map((c) => [c, r[c] ?? null])));
  const conceptLines = concepts
    .filter((c) => table.columns.includes(c.name))
    .map((c) => `- ${c.name} (${c.type})`)
    .join('\n');
  const base = [
    `New concept to derive: ${JSON.stringify(request.name)}`,
    `Description: ${request.description}`,
    `Source columns: ${JSON.stringify(sources)}`,
    `All columns in the table (${table.rows.length} rows):\n${conceptLines}`,
    `Sample rows (source columns only):\n${JSON.stringify(sample, null, 1)}`,
  ].join('\n\n');
  return VARIANTS.slice(0, n).map((v) => `${base}\n\nGuidance: ${v}`);
}

export function extractCode(text: string): string {
  const fence = text.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
  const code = (fence ? fence[1] : text).trim();
  if (!/function\s+derive\s*\(/.test(code)) throw new Error('response does not define function derive');
  return code;
}

/** [model generate]~: llm_prompts* -> code_candidates*. One model call per prompt, in parallel. */
export async function generateCodeCandidates(prompts: string[]): Promise<{ code: string; prompt: number; error?: string }[]> {
  return Promise.all(
    prompts.map(async (prompt, i) => {
      try {
        const text = await callModel({ system: DERIVE_SYSTEM, prompt });
        return { code: extractCode(text), prompt: i };
      } catch (e) {
        return { code: '', prompt: i, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}
