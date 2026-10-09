import { describe, expect, it } from 'vitest';
import { composeExampleRelation, reshape, stripAffixes } from '../shared/synth';
import { extractConcepts, assignConcepts } from '../shared/concepts';
import { toVegaLite } from '../shared/vega';
import type { Concept, Table } from '../shared/types';

const wide: Table = {
  id: 't', version: 1, name: 'temps', origin: 'loaded',
  columns: ['Date', 'Seattle Temperature', 'Atlanta Temperature'],
  rows: [
    { Date: '2023-01-01', 'Seattle Temperature': 51, 'Atlanta Temperature': 45 },
    { Date: '2023-01-08', 'Seattle Temperature': 45, 'Atlanta Temperature': 52 },
  ],
};

describe('process 1', () => {
  it('extracts typed concepts and translates a spec without transforming data', () => {
    const concepts = extractConcepts(wide);
    expect(concepts.map((c) => c.type)).toEqual(['temporal', 'quantitative', 'quantitative']);
    const v = toVegaLite({ mark: 'point', encodings: { x: 'Date', y: 'Seattle Temperature' } }, wide.rows, concepts) as any;
    expect(v.data.values).toBe(wide.rows);
    expect(v.encoding.x).toEqual({ field: 'Date', type: 'temporal' });
  });
});

describe('process 2: synthesizer', () => {
  const concepts: Concept[] = [
    ...extractConcepts(wide),
    { name: 'City', type: 'nominal', source: 'custom', examples: ['Seattle', 'Atlanta'] },
    { name: 'Temperature', type: 'quantitative', source: 'custom', examples: ['51', '45'] },
  ];
  const spec = { mark: 'line' as const, encodings: { x: 'Date', y: 'Temperature', color: 'City' } };

  it('composes an example relation seeded with examples', () => {
    const rel = composeExampleRelation(wide, spec, concepts);
    expect(rel.columns).toEqual(['Date', 'Temperature', 'City']);
    expect(rel.rows[0]).toEqual(['2023-01-01', '51', 'Seattle']);
    expect(rel.rows[1]).toEqual(['', '45', 'Atlanta']);
  });

  it('finds a fold program for wide -> long', () => {
    const rel = { columns: ['Date', 'Temperature', 'City'], rows: [['2023-01-01', '51', 'Seattle'], ['2023-01-01', '45', 'Atlanta']] };
    const cands = reshape(wide, spec, rel);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].program.op).toBe('fold');
    expect(cands[0].table.rows).toHaveLength(4);
    expect(cands[0].table.rows[1]).toEqual({ Date: '2023-01-01', City: 'Atlanta', Temperature: 45 });
    const next = assignConcepts({ ...wide, columns: cands[0].table.columns, rows: cands[0].table.rows }, concepts);
    expect(next.find((c) => c.name === 'City')?.source).toBe('reshaped');
  });

  it('rejects inconsistent examples', () => {
    const rel = { columns: ['Date', 'Temperature', 'City'], rows: [['2023-01-01', '99', 'Seattle']] };
    expect(reshape(wide, spec, rel)).toHaveLength(0);
  });

  it('finds a pivot program for long -> wide', () => {
    const long: Table = { ...wide, columns: ['Date', 'City', 'Temp'], rows: [
      { Date: 'a', City: 'Seattle', Temp: 1 }, { Date: 'a', City: 'Atlanta', Temp: 2 },
      { Date: 'b', City: 'Seattle', Temp: 3 }, { Date: 'b', City: 'Atlanta', Temp: 4 },
    ] };
    const s = { mark: 'point' as const, encodings: { x: 'Seattle', y: 'Atlanta' } };
    const cands = reshape(long, s, { columns: ['Seattle', 'Atlanta'], rows: [['1', '2'], ['3', '4']] });
    expect(cands.some((c) => c.program.op === 'pivot')).toBe(true);
  });

  it('strips common affixes', () => {
    expect(stripAffixes(['Seattle Temperature', 'Atlanta Temperature'])).toEqual({ 'Seattle Temperature': 'Seattle', 'Atlanta Temperature': 'Atlanta' });
  });
});
