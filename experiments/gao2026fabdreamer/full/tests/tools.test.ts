import { describe, expect, it } from 'vitest';
import { components, diffMask, fillHoles, openMask, pushPullFill, maskBox, type Mask } from '../server/tools/raster';
import { maskToPath } from '../server/tools/vectorize';
import { evaluateMask } from '../server/tools/maskQuality';
import { checkConstraints } from '../server/tools/constraints';
import { sanitizeSvg } from '../server/models/imageModel';
import { normalizePlan } from '../server/models/vlm';
import { autoLayout } from '../shared/autoLayout';
import type { Element, Workspace } from '../shared/types';

const rectMask = (w: number, h: number, rects: [number, number, number, number][]): Mask => {
  const m = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
};

describe('raster tools', () => {
  it('labels connected components', () => {
    const m = rectMask(20, 10, [[0, 0, 5, 5], [10, 0, 15, 5]]);
    expect(components(m, 20, 10).comps.length).toBe(2);
  });
  it('opening removes features thinner than the radius', () => {
    const m = rectMask(40, 40, [[5, 5, 30, 30], [30, 15, 39, 17]]); // block + 2px spur
    const o = openMask(m, 40, 40, 2);
    expect(o[16 * 40 + 35]).toBe(0);
    expect(o[15 * 40 + 15]).toBe(1);
  });
  it('fills enclosed holes', () => {
    const m = rectMask(10, 10, [[1, 1, 9, 9]]);
    m[5 * 10 + 5] = 0;
    expect(fillHoles(m, 10, 10)[55]).toBe(1);
  });
  it('push-pull fills holes from surroundings', () => {
    const w = 8,
      h = 8;
    const data = Buffer.alloc(w * h * 4, 0);
    for (let i = 0; i < w * h; i++) data.set([200, 100, 50, 255], i * 4);
    const hole = rectMask(w, h, [[2, 2, 6, 6]]);
    for (let i = 0; i < w * h; i++) if (hole[i]) data.set([0, 0, 0, 255], i * 4);
    const out = pushPullFill({ data, width: w, height: h }, hole);
    expect(out.data[(3 * w + 3) * 4]).toBeGreaterThan(150);
  });
  it('recovers a mask by differencing with a white background', () => {
    const w = 10,
      h = 10;
    const data = Buffer.alloc(w * h * 4, 255);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) data.set([20, 40, 200, 255], (y * w + x) * 4);
    expect(maskBox(diffMask({ data, width: w, height: h }), w, h)).toEqual([3, 3, 7, 7]);
  });
});

describe('vectorize + quality', () => {
  it('traces a mask into a closed path', () => {
    const d = maskToPath(rectMask(20, 20, [[4, 4, 16, 16]]), 20, 20);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
  it('flags masks that do not fit their box', () => {
    const m = rectMask(50, 50, [[0, 0, 5, 5]]);
    expect(evaluateMask(m, 50, 50, [20, 20, 45, 45], 0.9, 'initial').pass).toBe(false);
    const good = rectMask(50, 50, [[20, 20, 45, 45]]);
    expect(evaluateMask(good, 50, 50, [20, 20, 45, 45], 0.9, 'initial').pass).toBe(true);
  });
});

describe('model output validation', () => {
  it('sanitizes SVG and forces size', () => {
    const s = sanitizeSvg('here: <svg viewBox="0 0 10 10"><script>x</script><rect width="10" height="10"/></svg> done', 100, 100);
    expect(s).not.toContain('script');
    expect(s).toContain('width="100"');
  });
  it('normalizes layer plans', () => {
    const p = normalizePlan({ message: '', layers: [{ name: 'bg', depth: 5, elements: [{ name: 'sky', description: '' }] }, { name: 'fg', depth: 1, elements: [] }] });
    expect(p.layers.map((l) => l.name)).toEqual(['fg', 'bg']);
    expect(p.layers[1].depth).toBe(1);
  });
});

describe('tool_3 constraint checks', () => {
  const square = (id: string, x: number, y: number, size: number): Element => ({
    id,
    name: id,
    layerId: 'L0',
    origin: 'segment',
    width: size,
    height: size,
    path: `M0,0L${size},0L${size},${size}L0,${size}Z`,
    mask: '',
    texture: '',
    x,
    y,
    scale: 1,
    rotation: 0,
  });
  const ws = (els: Element[], frame = false): Workspace =>
    ({
      sourceId: 's',
      elements: Object.fromEntries(els.map((e) => [e.id, e])),
      canvas: { width: 200, height: 200, layers: [{ id: 'L0', name: 'front', depth: 0, frame, frameWidthMm: 6, visible: true, elementIds: els.map((e) => e.id) }] },
      material: { material: 'cardstock', thicknessMm: 0.6, minFeatureMm: 1.5, sheetWidthMm: 200, layerGapMm: 4 },
    }) as unknown as Workspace;

  it('detects floating pieces', async () => {
    const issues = await checkConstraints(ws([square('a', 50, 50, 40), square('b', 150, 150, 30)]));
    const floating = issues.filter((i) => i.type === 'floating');
    expect(floating.length).toBe(1);
    expect(floating[0].elementIds).toEqual(['b']);
    expect(floating[0].from).toBeDefined();
  });
  it('a frame connects pieces that touch it', async () => {
    const issues = await checkConstraints(ws([square('a', 20, 100, 40), square('b', 180, 100, 40)], true));
    expect(issues.filter((i) => i.type === 'floating').length).toBe(0);
  });
  it('detects thin features', async () => {
    const thin: Element = { ...square('t', 100, 100, 60), path: 'M0,0L60,0L60,1L0,1Z M0,20L60,20L60,60L0,60Z' };
    const issues = await checkConstraints(ws([thin]));
    expect(issues.some((i) => i.type === 'thin')).toBe(true);
  });
});

describe('tool_2 auto layout', () => {
  it('places elements at their source positions on their layers', () => {
    const e = { id: 'e', name: 'e', layerId: 'L1', origin: 'segment', width: 10, height: 10, path: '', mask: '', texture: '', x: 0, y: 0, scale: 2, rotation: 30, sourceBox: [10, 20, 30, 40] } as Element;
    const c = autoLayout({ layers: [{ id: 'L0', name: 'a', depth: 0, elements: [] }, { id: 'L1', name: 'b', depth: 1, elements: [] }] }, { e }, 100, 100);
    expect(c.layers[1].elementIds).toEqual(['e']);
    expect([e.x, e.y, e.scale, e.rotation]).toEqual([20, 30, 1, 0]);
  });
});
