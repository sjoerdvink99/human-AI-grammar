import { describe, expect, it } from 'vitest';
import { composeEncodingPrompts, describeDataset, extractAttributes, extractKeywords, parseCsv } from '../src/tools/tool1';
import { layoutWordCloud } from '../src/tools/wordcloud';
import { extractFragments } from '../src/tools/tool2';
import { composeGlyphs, defaultAssembly, extractContours, translateNumerical } from '../src/tools/tool3';
import { recommendLayout } from '../src/tools/tool4';
import { composeFgv } from '../src/tools/fgv';
import { sanitizeSvg } from '../server/models';
import type { GlyphImage, Mask } from '../src/types';

const csv = 'name,kind,size\na,cat,1\nb,dog,3\nc,cat,5\n';
const ds = parseCsv(csv, 'pets');
const attrs = extractAttributes(ds);

const gi: GlyphImage = {
  sourceId: 'x', concept: 'thing', width: 100, height: 100, minX: 0, minY: 0, defs: '',
  shapes: [
    { gid: 's0', tag: 'rect', markup: '<rect data-gid="s0" x="0" y="0" width="50" height="50" fill="red"/>', bbox: [0, 0, 50, 50], fill: 'red' },
    { gid: 's1', tag: 'circle', markup: '<circle data-gid="s1" cx="75" cy="75" r="10" fill="blue"/>', bbox: [65, 65, 20, 20], fill: 'blue' },
  ],
};
const masks: Mask[] = [{ id: 'm1', name: 'dot', box: [60, 60, 30, 30], gids: ['s1'], color: '#f00' }];
const mappings = [{ maskId: 'm1', categorical: 'kind', numerical: 'size' }];

describe('tool_1', () => {
  it('types attributes', () => {
    expect(attrs.map((a) => a.kind)).toEqual(['categorical', 'categorical', 'numerical']);
    expect(attrs[2]).toMatchObject({ min: 1, max: 5 });
    expect(attrs[1].values).toEqual(['cat', 'dog']);
    expect(describeDataset(ds, attrs)).toContain('"size": numerical, range 1 to 5');
  });
  it('extracts and cleans keywords', () => {
    const k = extractKeywords('{"keywords":[{"word":"Paw Print","weight":12},{"word":"paw print","weight":3},{"word":"a b c d","weight":4},{"word":"bone","weight":5}]}');
    expect(k).toEqual([{ word: 'paw print', weight: 10, reason: undefined }, { word: 'bone', weight: 5, reason: undefined }]);
    expect(layoutWordCloud(k)).toHaveLength(2);
  });
  it('composes one encoding prompt per category value', () => {
    const p = composeEncodingPrompts(mappings, { m1: 'a blue dot' }, attrs);
    expect(p.map((x) => x.value)).toEqual(['cat', 'dog']);
    expect(p[0].prompt).toContain('a blue dot');
  });
});

describe('tool_2 / tool_3', () => {
  it('cuts fragments and edges', () => {
    const { fragments, edges } = extractFragments(gi, masks);
    expect(fragments[0].shapes.map((s) => s.gid)).toEqual(['s1']);
    expect(edges[0].svg).toContain('fill="none"');
  });
  it('scales and duplicates by value and assembles glyphs', () => {
    const contours = extractContours(gi, masks);
    expect(contours[0]).toMatchObject({ cx: 75, cy: 75 });
    const settings = defaultAssembly(masks, mappings);
    const num = translateNumerical(gi, ds, attrs, mappings, contours, settings);
    expect(num).toHaveLength(3);
    expect(num[0].transforms[0]).toContain('matrix(0.5'); // min value → minScale
    const dup = { ...settings, parts: settings.parts.map((p) => ({ ...p, mode: 'dup-h' as const })) };
    const num2 = translateNumerical(gi, ds, attrs, mappings, contours, dup);
    expect(num2.map((n) => n.transforms.length)).toEqual([1, 3, 5]);
    const { fragments } = extractFragments(gi, masks);
    const cat = [{ maskId: 'm1', value: 'dog', styles: [{ gid: 's1', fill: '#00ff00', stroke: '#000000', texture: 'dots' as const, textureColor: '#ffffff' }] }];
    const set = composeGlyphs(gi, ds, masks, mappings, fragments, cat, num2, contours, dup);
    expect(set.glyphs).toHaveLength(3);
    expect(set.glyphs[1].svgInner).toContain('#00ff00');
    expect(set.glyphs[0].svgInner).not.toContain('#00ff00');
    expect(set.defs).toContain('tx-dots-ffffff');
    expect(set.viewBox[2]).toBeGreaterThan(100); // widened for 5 copies
  });
});

describe('tool_4 / fgv', () => {
  it('recommends by attribute types', () => {
    expect(recommendLayout({ theme: 'light', emphasis: [] }, attrs).recommended).toBe('grid');
    expect(recommendLayout({ theme: 'light', emphasis: ['size'] }, attrs).recommended).toBe('axis');
    expect(recommendLayout({ theme: 'light', emphasis: ['kind'] }, attrs).recommended).toBe('grouped');
    expect(recommendLayout({ theme: 'light', emphasis: ['kind', 'size'] }, attrs).recommended).toBe('strip');
    expect(recommendLayout({ theme: 'light', emphasis: ['kind', 'name'] }, attrs).recommended).toBe('matrix');
  });
  it('composes every layout', () => {
    const glyphs = { viewBox: [0, 0, 100, 100] as [number, number, number, number], defs: '', glyphs: ds.rows.map((_, i) => ({ row: i, svgInner: '<rect/>' })) };
    for (const [type, x, y] of [['grid', null, null], ['grouped', 'kind', null], ['axis', 'size', null], ['scatter', 'size', 'size'], ['matrix', 'kind', 'name'], ['strip', 'size', 'kind']] as const) {
      const f = composeFgv(glyphs, ds, attrs, { type, x, y, glyphSize: 40, spacing: 4, width: 600, labelColumn: 'name', showAxes: true, title: 't', overrides: {} }, { theme: 'dark', emphasis: [] });
      expect(Object.keys(f.centers)).toHaveLength(3);
      expect(f.svg.match(/class="glyph"/g)).toHaveLength(3);
    }
  });
});

describe('model_2 output validation', () => {
  it('sanitises SVG', () => {
    const s = sanitizeSvg('here: <svg><script>x</script><rect onclick="x()"/><circle/></svg>')!;
    expect(s).not.toContain('script');
    expect(s).not.toContain('onclick');
    expect(s).toContain('viewBox');
    expect(sanitizeSvg('no svg')).toBeNull();
  });
});
