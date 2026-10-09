import { describe, expect, it } from 'vitest';
import { findNode, parseProgram } from '../shared/dsl';
import { renderSvg } from '../shared/render';
import { extractSnippet, setAttribute, setParam, spliceSnippet, toRawValue } from '../shared/edit';
import { extractCodeBlock } from '../server/compose';

const SRC = `canvas 400 300 background="#f4f1ea"
param house_w = 160 [60, 300]
param roof_color = "#a0522d"
group house x=120 y=100 {
  rect walls x=0 y=60 w=house_w h=100 fill="#e8d8b0"
  polygon roof points="0,60 {house_w/2},0 {house_w},60" fill=roof_color
}
circle sun cx=340 cy=50 r=(house_w / 8) fill="gold"`;

function parse(code: string) {
  const r = parseProgram(code);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.program;
}

describe('tool translate', () => {
  it('builds tree (r4), params (r6) and svg (r5)', () => {
    const p = parse(SRC);
    expect(p.params.map((x) => [x.name, x.type, x.value])).toEqual([
      ['house_w', 'number', 160], ['roof_color', 'color', '#a0522d'],
    ]);
    expect(p.nodes.map((n) => n.id)).toEqual(['house', 'sun']);
    const roof = findNode(p.nodes, 'house/roof')!;
    expect(roof.attrs.points.value).toBe('0,60 80,0 160,60');
    expect(roof.attrs.fill.value).toBe('#a0522d');
    expect(findNode(p.nodes, 'sun')!.attrs.r.value).toBe(20);
    expect(findNode(p.nodes, 'house')!).toMatchObject({ startLine: 4, endLine: 7 });
    const svg = renderSvg(p);
    expect(svg).toContain('data-node-id="house/walls"');
    expect(svg).toContain('width="160"');
  });

  it('reports errors with line numbers', () => {
    const r = parseProgram('canvas 10 10\nrect a x=foo\nblob b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe('tool modify / extract', () => {
  it('sets an attribute (process 3)', () => {
    const p = parse(SRC);
    const code = setAttribute(SRC, findNode(p.nodes, 'house/walls')!, 'h', '120');
    expect(findNode(parse(code).nodes, 'house/walls')!.attrs.h.value).toBe(120);
    const code2 = setAttribute(SRC, findNode(p.nodes, 'house')!, 'rotate', '10');
    expect(code2.split('\n')[3]).toBe('group house x=120 y=100 rotate=10 {');
  });

  it('sets a parameter keeping its range (process 4)', () => {
    const p = parse(SRC);
    const code = setParam(SRC, p.params[0], '200');
    expect(code.split('\n')[1]).toBe('param house_w = 200 [60, 300]');
    expect(findNode(parse(code).nodes, 'house/roof')!.attrs.points.value).toBe('0,60 100,0 200,60');
  });

  it('extracts and splices a snippet (process 5)', () => {
    const snip = extractSnippet(SRC, 4, 7);
    expect(snip.split('\n')[1]).toBe('  rect walls x=0 y=60 w=house_w h=100 fill="#e8d8b0"');
    const code = spliceSnippet(SRC, 5, 5, 'rect walls x=0 y=50 w=house_w h=110 fill="#ccc"\nrect door x=60 y=110 w=30 h=50');
    const p = parse(code);
    expect(findNode(p.nodes, 'house/door')).toBeTruthy();
    expect(code.split('\n')[5]).toBe('  rect door x=60 y=110 w=30 h=50');
  });

  it('quotes free text but keeps expressions', () => {
    const params = parse(SRC).params;
    expect(toRawValue('red', 'fill', params)).toBe('"red"');
    expect(toRawValue('roof_color', 'fill', params)).toBe('roof_color');
    expect(toRawValue('house_w/2', 'x', params)).toBe('house_w/2');
  });

  it('extracts fenced code from model answers', () => {
    expect(extractCodeBlock('sure\n```shape\ncanvas 1 1\n```\n')).toBe('canvas 1 1');
  });
});
