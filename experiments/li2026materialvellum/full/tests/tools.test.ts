import { describe, expect, it } from 'vitest';
import { relaxBands, stepMagnets, enforceIkebana, IKEBANA_RATIO } from '../src/tools/physics';
import { composePlan, initDensity, sculpt, magnetsToMasks, compositeInpaint } from '../src/tools/urbanPre';
import { brushSand, detectClusters, emptySand } from '../src/tools/sand';
import { composeSpecs, transcriptToRole } from '../src/tools/posterPre';
import { toScribble, toIkebanaPrompt } from '../src/tools/ikebanaPre';
import { ikebanaCanvas1 } from '../src/ikebana/types';
import { pointInPolygon, resampleClosed } from '../src/tools/geometry';
import { sanitizeSvg, stripBackground, extractSvg } from '../server/svg';
import type { ZoningBand, Vec, Magnet } from '../src/urban/types';

const square = (x: number, y: number, s: number): Vec[] => resampleClosed([[x, y], [x + s, y], [x + s, y + s], [x, y + s]], 40);

describe('tool_1 physics', () => {
  it('keeps bands inside the site and apart', () => {
    const a: ZoningBand = { id: 'a', zone: 'park', points: square(-50, -50, 300) };
    const b: ZoningBand = { id: 'b', zone: 'commercial', points: square(150, 150, 300) };
    const out = relaxBands([a, b], 600, [], 30);
    for (const band of out) for (const p of band.points) {
      expect(p[0]).toBeGreaterThanOrEqual(0); expect(p[0]).toBeLessThanOrEqual(600);
    }
    const inside = out[1].points.filter((p) => pointInPolygon(p, out[0].points)).length;
    expect(inside).toBeLessThan(4);
  });
  it('repels incompatible magnets and attracts compatible ones', () => {
    let ms: Magnet[] = [
      { id: 'h', fn: 'hospital' as const, x: 200, y: 200 },
      { id: 's', fn: 'sports' as const, x: 260, y: 200 },
    ];
    for (let i = 0; i < 50; i++) ms = stepMagnets(ms, 512);
    expect(Math.abs(ms[0].x - ms[1].x)).toBeGreaterThan(150);
    let ok: Magnet[] = [
      { id: 'p', fn: 'park' as const, x: 100, y: 100 },
      { id: 's', fn: 'school' as const, x: 300, y: 100 },
    ];
    for (let i = 0; i < 50; i++) ok = stepMagnets(ok, 512);
    expect(Math.abs(ok[0].x - ok[1].x)).toBeLessThan(120);
  });
  it('keeps ikebana proportions', () => {
    const o = ikebanaCanvas1.origin;
    const els = enforceIkebana([
      { id: 'shin', kind: 'shin', x: 300, y: 100, r: 20 },
      { id: 'soe', kind: 'soe', x: 100, y: 300, r: 20 },
      { id: 'hikae', kind: 'hikae', x: 400, y: 380, r: 20 },
    ], o, 512, { id: 'soe', pos: [150, 250] });
    const len = (k: string) => { const e = els.find((x) => x.kind === k)!; return Math.hypot(e.x - o[0], e.y - o[1]); };
    expect(len('soe') / len('shin')).toBeCloseTo(IKEBANA_RATIO.soe, 2);
    expect(len('hikae') / len('shin')).toBeCloseTo(IKEBANA_RATIO.hikae, 2);
    const scr = toScribble(els, ikebanaCanvas1);
    expect(scr.circles).toHaveLength(3);
    expect(toIkebanaPrompt(els)).toMatch(/ikebana/);
  });
});

describe('tool_3 urban', () => {
  it('composes plan, density, masks', () => {
    const plan = composePlan([{ id: 'a', zone: 'commercial', points: square(0, 0, 300) }]);
    expect(plan.blocks.filter((b) => b.zone === 'commercial').length).toBeGreaterThan(20);
    const d = initDensity(plan);
    const d2 = sculpt(d, 20, 20, 3, 'raise');
    expect(d2[19][19]).toBeGreaterThan(d[19][19]);
    const { masks, prompts } = magnetsToMasks([{ id: 'm1', fn: 'park', x: 10, y: 10 }, { id: 'm2', fn: 'school', x: 12, y: 12 }]);
    expect(masks[0]).not.toEqual(masks[1]);
    expect(prompts[0]).toMatch(/park/);
    expect(compositeInpaint('<svg></svg>', masks, [{ id: 'm1', svg: '<g/>' }])).toMatch(/clip-path="url\(#inpaint-m1\)"/);
  });
});

describe('sand + poster', () => {
  it('detects clusters with stable ids and builds specs', () => {
    let g = emptySand();
    for (let i = 0; i < 5; i++) g = brushSand(g, 100, 100, 0, 0, 'pour', 30);
    for (let i = 0; i < 5; i++) g = brushSand(g, 400, 400, 0, 0, 'pour', 30);
    const c1 = detectClusters(g);
    expect(c1).toHaveLength(2);
    g = brushSand(g, 400, 400, 0, 0, 'pour', 40);
    const c2 = detectClusters(g, c1);
    expect(c2.map((c) => c.id).sort()).toEqual(c1.map((c) => c.id).sort());
    expect(transcriptToRole('this is the title')).toBe('title');
    expect(transcriptToRole('make it a picture')).toBe('image');
    expect(transcriptToRole('banana')).toBeNull();
    const specs = composeSpecs('jazz', c2, { [c2[0].id]: 'title' });
    expect(specs).toHaveLength(1);
    expect(specs[0].request).toMatch(/jazz/);
  });
});

describe('svg validation', () => {
  it('sanitizes and strips backgrounds', () => {
    const s = extractSvg('here: <svg><script>x()</script><rect width="100%" height="100%" fill="red"/><circle onload="x()" r="3"/></svg> done');
    expect(s).not.toMatch(/script|onload/);
    expect(stripBackground(s, 10, 10)).not.toMatch(/fill="red"/);
    expect(sanitizeSvg('<svg/>')).toMatch(/xmlns/);
  });
});
