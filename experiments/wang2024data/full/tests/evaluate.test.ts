import { describe, expect, it } from 'vitest';
import { evaluateCandidates, extractCode } from '../server/evaluate';
import { composePrompts } from '../server/derive';

const rows = [{ a: 1, b: 2 }, { a: 3, b: null }];

describe('process 3: compose and evaluate', () => {
  it('composes contextualized TypeScript prompts', () => {
    const p = composePrompts({ sources: ['a', 'b'], name: 'sum', description: 'a plus b' }, rows, { a: 'quantitative', b: 'quantitative' });
    expect(p).toHaveLength(3);
    expect(p[0]).toContain('"a": number | null;');
    expect(p[0]).toContain('function derive(row: Row');
  });

  it('extracts code from a fenced reply', () => {
    expect(extractCode('here\n```typescript\nfunction derive(row: any) { return 1; }\n```')).toContain('return 1');
    expect(extractCode('no code')).toBeNull();
  });

  it('keeps only functions that run on every row and builds previews', () => {
    const good = 'function derive(row: { a: number; b: number | null }): number | null { return row.b === null ? null : row.a + row.b; }';
    const bad = 'function derive(row: any): number { return row.b.toFixed(1); }';
    const res = evaluateCandidates([{ code: good, prompt: 0 }, { code: bad, prompt: 1 }, { code: good, prompt: 2 }], rows, ['a', 'b'], 'sum');
    expect(res).toHaveLength(2);
    expect(res[0].valid).toBe(true);
    expect(res[0].preview).toEqual([{ a: 1, b: 2, sum: 3 }, { a: 3, b: null, sum: null }]);
    expect(res[1].valid).toBe(false);
  });

  it('times out infinite loops', () => {
    const res = evaluateCandidates([{ code: 'function derive() { while (true) {} }', prompt: 0 }], rows, ['a'], 'x');
    expect(res[0].valid).toBe(false);
  });
});
