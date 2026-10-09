import { describe, expect, it } from 'vitest';
import { area, components, decodeMask, dilate, emptyMask, maskToSegment, open, polygonsToMask, traceMask, W } from '../server/mask.ts';
import { foregroundMask, listShapeIds, normalizeSvg, removeIds, renderIdMask } from '../server/svg.ts';
import { evaluateConstraints, executeFix, validateFixCall } from '../server/constraints.ts';
import { assignRemainder } from '../server/processes.ts';
import { evaluateMask } from '../server/pipeline.ts';
import { DEFAULT_MATERIAL, type Canvas, type StoredSegment } from '../shared/types.ts';

const or = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => v | b[i]) as Uint8Array;
const rect = (x: number, y: number, w: number, h: number) => polygonsToMask([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]);

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#88ccff"/><circle id="sun" cx="50" cy="30" r="10" fill="#ffcc00"/><g id="hill"><path d="M0 80 L50 50 L100 80 L100 100 L0 100Z" fill="#228833"/></g><script>alert(1)</script></svg>`;

describe('svg tools', () => {
  it('normalizes to 512 viewBox, strips scripts, assigns ids', () => {
    const n = normalizeSvg(SVG);
    expect(n).toContain('viewBox="0 0 512 512"');
    expect(n).not.toContain('script');
    const ids = listShapeIds(n);
    expect(ids).toContain('sun');
    expect(ids).toContain('hill');
    expect(ids.length).toBeGreaterThanOrEqual(4);
  });
  it('renders a mask for selected ids only', () => {
    const n = normalizeSvg(SVG);
    const m = renderIdMask(n, ['sun']);
    const a = area(m);
    const expected = Math.PI * (10 * 5.12) ** 2;
    expect(Math.abs(a - expected) / expected).toBeLessThan(0.05);
    const hill = renderIdMask(n, ['hill']);
    expect(area(hill)).toBeGreaterThan(30000);
  });
  it('removes ids and extracts foreground on white', () => {
    const n = removeIds(normalizeSvg(SVG), ['sun']);
    expect(listShapeIds(n)).not.toContain('sun');
    const iso = normalizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#fff"/><rect x="100" y="100" width="50" height="60" fill="#333"/></svg>`);
    expect(area(foregroundMask(iso))).toBe(3000);
  });
});

describe('mask tools', () => {
  it('fills polygons and counts components', () => {
    const m = rect(10, 10, 20, 20);
    expect(area(m)).toBe(400);
    const two = or(rect(10, 10, 20, 20), rect(100, 100, 5, 5));
    expect(components(two).sizes.length - 1).toBe(2);
  });
  it('traces a path with holes', () => {
    const outer = rect(10, 10, 40, 40);
    const hole = rect(20, 20, 10, 10);
    const m = outer.map((v, i) => (v && !hole[i] ? 1 : 0)) as Uint8Array;
    const d = traceMask(m);
    expect((d.match(/M/g) ?? []).length).toBe(2);
    const seg = maskToSegment(m, { id: 's', label: 'x', layerId: 'l', color: '#000000', source: 'detected' })!;
    expect(area(decodeMask(seg))).toBe(area(m));
  });
  it('opening removes thin features, dilation grows', () => {
    const m = or(rect(10, 10, 60, 60), rect(70, 38, 60, 2));
    const o = open(m, 3);
    expect(area(o)).toBeLessThan(area(m) - 100);
    expect(area(dilate(rect(50, 50, 10, 10), 2))).toBeGreaterThan(100);
  });
  it('assignRemainder partitions the whole mask', () => {
    const whole = rect(0, 0, 100, 100);
    const parts = [rect(0, 0, 30, 100), rect(70, 0, 30, 100)];
    assignRemainder(whole, parts);
    expect(area(parts[0]) + area(parts[1])).toBe(10000);
    expect(area(parts[0].map((v, i) => v & parts[1][i]) as Uint8Array)).toBe(0);
  });
  it('flags empty masks in quality evaluation', () => {
    expect(evaluateMask(emptyMask(), { itemId: 'a', label: 'a', prompt: '' }).ok).toBe(false);
    expect(evaluateMask(rect(10, 10, 50, 50), { itemId: 'a', label: 'a', prompt: '' }).ok).toBe(true);
  });
});

describe('constraint tools', () => {
  const mk = (id: string, layerId: string, m: Uint8Array, source: StoredSegment['source'] = 'detected') => maskToSegment(m, { id, label: id, layerId, color: '#123456', source })!;
  const canvas = (): Canvas<StoredSegment> => ({
    version: 1,
    width: W,
    height: W,
    layers: [
      { id: 'back', name: 'Back', depth: 0, visible: true },
      { id: 'front', name: 'Front', depth: 1, visible: true },
    ],
    segments: [
      mk('board', 'back', rect(0, 0, 200, 512), 'background'),
      mk('stick', 'front', or(rect(100, 100, 100, 100), rect(200, 140, 80, 2))),
      mk('floater', 'front', rect(400, 400, 60, 60)),
      mk('crumb', 'front', rect(100, 300, 2, 2)),
    ],
  });
  it('finds thin, unsupported and small issues', () => {
    const issues = evaluateConstraints(canvas(), DEFAULT_MATERIAL);
    const types = issues.map((i) => `${i.type}:${i.segmentId}`);
    expect(types).toContain('thin_feature:stick');
    expect(types).toContain('unsupported:floater');
    expect(types).toContain('small_fragments:crumb');
  });
  it('validates and executes fix calls', () => {
    const c = canvas();
    expect(() => validateFixCall({ tool: 'deleteSegment', args: { segmentId: 'nope' } }, c)).toThrow();
    const after = executeFix({ tool: 'moveToLayer', args: { segmentId: 'floater', layerId: 'back' } }, c, DEFAULT_MATERIAL);
    expect(after.segments.find((s) => s.id === 'floater')!.layerId).toBe('back');
    const trimmed = executeFix({ tool: 'removeThinParts', args: { segmentId: 'stick', mm: 1.5 } }, c, DEFAULT_MATERIAL);
    expect(trimmed.segments.find((s) => s.id === 'stick')!.area).toBeLessThan(c.segments.find((s) => s.id === 'stick')!.area);
    const merged = executeFix({ tool: 'mergeLayers', args: { sourceLayerId: 'front', targetLayerId: 'back' } }, c, DEFAULT_MATERIAL);
    expect(merged.layers.length).toBe(1);
  });
});
