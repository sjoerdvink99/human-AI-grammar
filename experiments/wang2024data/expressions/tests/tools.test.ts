import { describe, expect, it } from 'vitest';
import { assignConcepts, extractConcepts } from '../src/shared/concepts';
import { runReshape } from '../src/shared/reshape';
import { SAMPLES } from '../src/shared/samples';
import { composeExampleRelation, isConsistent, synthesizeReshapes } from '../src/shared/synthesize';
import { translateToVegaLite } from '../src/shared/translate';
import type { ChartSpec, Table } from '../src/shared/types';
import { composeDerivationPrompts, extractCode, generateCodeCandidates } from '../server/derive';
import { applyDerivation, evaluateCandidates } from '../server/sandbox';

const wide = SAMPLES['Weekly temperatures (wide)']();

describe('process 1: extract, translate', () => {
  it('extracts typed concepts', () => {
    const cs = extractConcepts(wide);
    expect(cs.map((c) => [c.name, c.type])).toEqual([['Date', 'temporal'], ['Seattle', 'quantitative'], ['Atlanta', 'quantitative']]);
  });
  it('translates a chart_spec to Vega-Lite', () => {
    const spec: ChartSpec = { mark: 'line', encodings: { x: { field: 'Date' }, y: { field: 'Seattle', aggregate: 'mean' } } };
    const vl = translateToVegaLite(spec, wide, extractConcepts(wide)) as any;
    expect(vl.encoding.x).toEqual({ field: 'Date', type: 'temporal' });
    expect(vl.encoding.y).toEqual({ field: 'Seattle', type: 'quantitative', aggregate: 'mean' });
    expect(vl.data.values).toHaveLength(60);
  });
});

describe('process 2: example relation, synthesis, reshape, assign', () => {
  const spec: ChartSpec = { mark: 'line', encodings: { x: { field: 'Date' }, y: { field: 'Temperature' }, color: { field: 'City' } } };

  it('composes an example relation from the chart_spec fields', () => {
    const ex = composeExampleRelation(spec, wide);
    expect(ex.columns).toEqual(['Date', 'Temperature', 'City']);
    expect(ex.rows[0].Date).toBe(wide.rows[0].Date);
    expect(ex.rows[0].City).toBeNull();
  });

  it('asks for example values for new concepts', () => {
    expect(synthesizeReshapes(wide, composeExampleRelation(spec, wide)).programs).toHaveLength(0);
  });

  it('synthesizes pivot_longer from a filled example', () => {
    const ex = composeExampleRelation(spec, wide);
    ex.rows[0] = { ...ex.rows[0], City: 'Seattle', Temperature: wide.rows[0].Seattle };
    ex.rows[1] = { ...ex.rows[1], City: 'Atlanta', Temperature: wide.rows[0].Atlanta };
    const { programs } = synthesizeReshapes(wide, ex);
    expect(programs.length).toBeGreaterThan(0);
    const p = programs[0];
    expect(p.kind).toBe('pivot_longer');
    const t = runReshape(p, wide);
    expect(t.rows).toHaveLength(120);
    expect(isConsistent(t, ex)).toBe(true);
    const cs = assignConcepts(t, [...extractConcepts(wide), { name: 'City', type: 'nominal', source: 'custom' }]);
    expect(cs.find((c) => c.name === 'City')?.source).toBe('table');
    expect(cs.find((c) => c.name === 'Temperature')?.type).toBe('quantitative');
  });

  it('rejects inconsistent examples', () => {
    const ex = composeExampleRelation(spec, wide);
    ex.rows[0] = { ...ex.rows[0], City: 'Seattle', Temperature: 99999 };
    expect(synthesizeReshapes(wide, ex).programs).toHaveLength(0);
  });

  it('synthesizes pivot_wider from a long table', () => {
    const long = runReshape({ kind: 'pivot_longer', cols: ['Seattle', 'Atlanta'], namesTo: 'City', valuesTo: 'Temp', keep: ['Date'] }, wide);
    const spec2: ChartSpec = { mark: 'point', encodings: { x: { field: 'Seattle' }, y: { field: 'Atlanta' } } };
    const ex: Table = { columns: ['Seattle', 'Atlanta'], rows: [{ Seattle: wide.rows[0].Seattle, Atlanta: wide.rows[0].Atlanta }] };
    expect(composeExampleRelation(spec2, long).columns).toEqual(['Seattle', 'Atlanta']);
    const { programs } = synthesizeReshapes(long, ex);
    expect(programs[0].kind).toBe('pivot_wider');
    expect(runReshape(programs[0], long).rows).toHaveLength(60);
  });
});

describe('processes 3/4: compose, generate (mock), evaluate, execute', () => {
  const req = { name: 'Diff', sourceConcepts: ['Seattle', 'Atlanta'], description: 'Seattle minus Atlanta' };

  it('composes one prompt per variant from table, concepts and request', () => {
    const ps = composeDerivationPrompts(req, wide, extractConcepts(wide));
    expect(ps).toHaveLength(3);
    expect(ps[0]).toContain('Seattle minus Atlanta');
    expect(new Set(ps).size).toBe(3);
  });

  it('extracts code from a fenced reply', () => {
    expect(extractCode('```js\nfunction derive(row){return 1}\n```')).toBe('function derive(row){return 1}');
    expect(() => extractCode('no code')).toThrow();
  });

  it('evaluates candidates: valid, failing, duplicate, all-null', () => {
    const codes = [
      { code: 'function derive(r){ return r.Seattle - r.Atlanta; }', prompt: 0 },
      { code: 'function derive(r){ throw new Error("boom"); }', prompt: 1 },
      { code: 'function derive(row){ return row.Seattle - row.Atlanta; }', prompt: 2 },
      { code: 'function derive(r){ return null; }', prompt: 3 },
      { code: 'function derive(r){ while(true){} }', prompt: 4 },
    ];
    const out = evaluateCandidates(codes, wide, req);
    expect(out.map((c) => c.valid)).toEqual([true, false, false, false, false]);
    expect(out[0].preview?.columns).toEqual(['Seattle', 'Atlanta', 'Diff']);
    expect(out[4].error).toMatch(/timed out/);
  });

  it('applies selected code and replaces on re-derivation', () => {
    const t3 = applyDerivation('function derive(r){ return r.Seattle - r.Atlanta; }', wide, 'Diff');
    expect(t3.columns).toEqual(['Date', 'Seattle', 'Atlanta', 'Diff']);
    const t4 = applyDerivation('function derive(r){ return r.Atlanta - r.Seattle; }', t3, 'Diff');
    expect(t4.columns).toHaveLength(4);
    expect(t4.rows[0].Diff).toBe(-(t3.rows[0].Diff as number));
  });

  it('runs the model step through callModel (mock provider)', async () => {
    process.env.MOCK_MODEL = '1';
    const codes = await generateCodeCandidates(composeDerivationPrompts(req, wide, []));
    expect(codes.every((c) => !c.error)).toBe(true);
    expect(evaluateCandidates(codes, wide, req).filter((c) => c.valid)).toHaveLength(1);
  });
});
