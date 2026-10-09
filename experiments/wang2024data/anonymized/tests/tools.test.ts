import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../src/data';
import { extractFields, assignFields } from '../src/tools/extract';
import { translateToSpec, lookupFromFields } from '../src/tools/translate';
import { composeExampleTable } from '../src/tools/composeExample';
import { synthesizePrograms } from '../src/tools/synthesize';
import { runProgram } from '../src/tools/reshape';
import { composePrompts } from '../src/tools/composePrompts';
import { evaluateCandidates, applyDerivation } from '../server/sandbox';
import { extractCode } from '../server/model';
import type { Encoding } from '../src/types';

const wide = SAMPLES['Fruit sales (wide)']();
const long = SAMPLES['City temperatures (long)']();
const students = SAMPLES['Student scores']();

describe('process 1', () => {
  it('extracts field types and translates an encoding', () => {
    const f = extractFields(wide);
    expect(f.find((x) => x.name === 'Q1')?.type).toBe('quantitative');
    expect(f.find((x) => x.name === 'Fruit')?.type).toBe('nominal');
    expect(extractFields(long).find((x) => x.name === 'Date')?.type).toBe('temporal');
    const spec = translateToSpec({ mark: 'bar', channels: { x: 'Fruit', y: 'Q1' }, aggregate: {} }, lookupFromFields(f)) as any;
    expect(spec.encoding.x).toEqual({ field: 'Fruit', type: 'nominal' });
    expect(spec.mark.type).toBe('bar');
  });
});

describe('process 2', () => {
  it('synthesizes a fold from examples', () => {
    const enc: Encoding = { mark: 'line', channels: { x: 'Quarter', y: 'Sales', color: 'Fruit' }, aggregate: {} };
    const ex = composeExampleTable(wide, enc);
    expect(ex.columns).toEqual(['Quarter', 'Sales', 'Fruit']);
    expect(ex.rows[0].Fruit).toBe('Apples');
    ex.rows[0].Quarter = 'Q1';
    ex.rows[0].Sales = '120';
    ex.rows[1].Quarter = 'Q2';
    const programs = synthesizePrograms(wide, extractFields(wide), ex);
    expect(programs.length).toBeGreaterThan(0);
    expect(programs[0]).toMatchObject({ op: 'fold', key: 'Quarter', value: 'Sales' });
    const t = runProgram(wide, programs[0]);
    expect(t.rows).toHaveLength(20);
    const f = assignFields(t, extractFields(wide));
    expect(f.find((x) => x.name === 'Sales')).toMatchObject({ source: 'reshaped', type: 'quantitative' });
  });

  it('synthesizes a pivot from examples', () => {
    const enc: Encoding = { mark: 'point', channels: { x: 'Harborview', y: 'Northfield' }, aggregate: {} };
    const ex = composeExampleTable(long, enc);
    ex.rows[0] = { Harborview: String(long.rows[0].Temperature), Northfield: '' };
    ex.rows = [ex.rows[0]];
    const programs = synthesizePrograms(long, extractFields(long), ex);
    expect(programs.some((p) => p.op === 'pivot' && p.key === 'City')).toBe(true);
  });

  it('rejects programs that contradict the example', () => {
    const enc: Encoding = { mark: 'line', channels: { x: 'Quarter', y: 'Sales', color: 'Fruit' }, aggregate: {} };
    const ex = composeExampleTable(wide, enc);
    ex.rows[0].Quarter = 'Q1';
    ex.rows[0].Sales = '999';
    expect(synthesizePrograms(wide, extractFields(wide), ex)).toHaveLength(0);
  });
});

describe('process 3', () => {
  it('composes prompts and evaluates/applies code candidates', () => {
    const fields = extractFields(students);
    const req = { name: 'Average', description: 'mean of Math and Reading', sourceFields: ['Math', 'Reading'] };
    const prompts = composePrompts(students, fields, req);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('function derive(row, index, table)');
    const good = 'function derive(row) { return (row.Math + row.Reading) / 2; }';
    const dup = 'function derive(row) { return (row.Reading + row.Math) / 2; }';
    const bad = 'function derive(row) { throw new Error("x"); }';
    const loop = 'function derive(row) { while(true){} }';
    const { evaluated, rejected } = evaluateCandidates(
      [
        { id: 'c1', code: good, promptIndex: 0 },
        { id: 'c2', code: dup, promptIndex: 1 },
        { id: 'c3', code: bad, promptIndex: 2 },
        { id: 'c4', code: loop, promptIndex: 2 },
      ],
      students,
      'Average',
      req.sourceFields,
    );
    expect(evaluated.map((e) => e.id)).toEqual(['c1']);
    expect(rejected).toHaveLength(3);
    expect(evaluated[0].preview.columns).toEqual(['Math', 'Reading', 'Average']);
    const t = applyDerivation(good, students, 'Average');
    expect(t.rows[0].Average).toBe(81.5);
  });

  it('extracts code from a fenced response', () => {
    expect(extractCode('Sure:\n```javascript\nfunction derive(row) { return 1; }\n```')).toContain('return 1');
    expect(extractCode('no code')).toBeNull();
  });
});
