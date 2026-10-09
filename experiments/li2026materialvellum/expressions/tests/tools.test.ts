import { describe, expect, it } from 'vitest';
import {
  createSite, tool1CleanBands, tool1SettleMagnets, tool2ApplyDensity, tool2PlanToCityModel,
  tool3CityToDensity, tool3CityToDepthMap, tool3ComposePlan, tool3MagnetsToMasks,
} from '../src/urban/tools';
import { createIkebanaCanvas, tool1TidyElements, tool3ElementsToScribble } from '../src/ikebana/tools';
import { fitText, tool3ComposePoster, tool3ComposeSpecs, tool3SpeechToRoles } from '../src/poster/tools';
import { normalizeSvg, sanitizeSvgFragment } from '../server/svg';

describe('process 1 tools', () => {
  const site = createSite();
  const bands = [
    { id: 'a', zone: 'office' as const, width: 70, points: [{ x: 20, y: 300 }, { x: 250, y: 310 }, { x: 500, y: 300 }] },
    { id: 'b', zone: 'green' as const, width: 40, points: [{ x: 400, y: 20 }, { x: 420, y: 200 }] },
    { id: 'tiny', zone: 'residential' as const, width: 40, points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] },
  ];
  it('chains bands → plan → city → density → depth', () => {
    const b2 = tool1CleanBands(bands, site);
    expect(b2.map((b) => b.id)).toEqual(['a', 'b']);
    const plan = tool3ComposePlan(b2, site);
    expect(plan.cells).toContain('office');
    expect(plan.cells).toContain('road');
    expect(plan.cells).toContain('water');
    const c1 = tool2PlanToCityModel(plan);
    expect(c1.buildings.length).toBeGreaterThan(10);
    const d1 = tool3CityToDensity(c1);
    expect(d1.values).toHaveLength(64);
    const d2 = { ...d1, values: d1.values.map((v, i) => (i === 0 ? 0.6 : v * 2)) };
    const c2 = tool2ApplyDensity(c1, d2);
    const after = tool3CityToDensity(c2);
    expect(after.values[0]).toBeGreaterThan(0.3);
    const dm = tool3CityToDepthMap(c2);
    expect(dm.levels).toHaveLength(32 * 32);
    expect(Math.max(...dm.levels)).toBeLessThanOrEqual(9);
  });
  it('settles overlapping magnets and makes masks', () => {
    const m2 = tool1SettleMagnets([
      { id: 'x', fn: 'park', x: 100, y: 100, r: 0 },
      { id: 'y', fn: 'plaza', x: 105, y: 100, r: 0 },
    ]);
    expect(Math.hypot(m2[0].x - m2[1].x, m2[0].y - m2[1].y)).toBeGreaterThan(70);
    const { masks, prompts } = tool3MagnetsToMasks(m2);
    expect(masks).toHaveLength(2);
    expect(prompts[0].text).toMatch(/park/);
  });
});

describe('process 2 tools', () => {
  const canvas = createIkebanaCanvas();
  it('snaps stems into the vase and flowers to tips', () => {
    const els = tool1TidyElements([
      { id: 's', kind: 'branch', points: [{ x: 120, y: 80 }, { x: 160, y: 200 }, { x: 210, y: 360 }], size: 0 },
      { id: 'f', kind: 'flower', points: [{ x: 130, y: 90 }], size: 25 },
    ], canvas);
    const stem = els.find((e) => e.id === 's')!;
    expect(Math.abs(stem.points[0].y - canvas.mouth.y)).toBeLessThan(10);
    const flower = els.find((e) => e.id === 'f')!;
    expect(flower.points[0]).toEqual(stem.points[stem.points.length - 1]);
    const { scribble, prompt } = tool3ElementsToScribble(els, canvas);
    expect(scribble.strokes).toHaveLength(3);
    expect(prompt).toMatch(/1 branch/);
  });
});

describe('process 3 tools', () => {
  it('maps speech to roles and composes specs and poster', () => {
    const roles = tool3SpeechToRoles([
      { clusterId: 'a', transcript: 'this is the title' },
      { clusterId: 'b', transcript: 'a picture of the river' },
      { clusterId: 'c', transcript: 'banana' },
    ]);
    expect(roles.map((r) => r.role)).toEqual(['title', 'image', 'unknown']);
    const sq = (x: number, y: number) => [{ x, y }, { x: x + 200, y }, { x: x + 200, y: y + 80 }, { x, y: y + 80 }];
    const clusters = [{ id: 'b', points: sq(40, 200) }, { id: 'a', points: sq(40, 40) }, { id: 'c', points: sq(40, 400) }];
    const specs = tool3ComposeSpecs('Jazz night', clusters, roles);
    expect(specs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(specs[0].maxChars).toBeGreaterThan(5);
    const svg = tool3ComposePoster(specs, [{ id: 'a', text: 'Jazz by the river' }], [{ id: 'b', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }], clusters);
    expect(svg).toContain('JAZZ');
    expect(svg).toContain('<image');
  });
  it('fits text into a box', () => {
    const { lines, size } = fitText('hello wonderful world of posters', { x: 0, y: 0, w: 100, h: 60 }, 40);
    expect(lines.length * size * 1.2).toBeLessThanOrEqual(60);
  });
});

describe('svg validation', () => {
  it('strips scripts and external refs', () => {
    const s = sanitizeSvgFragment('<g onclick="x()"><script>alert(1)</script><image href="http://x"/><rect fill="url(#g)" style="fill:url(\'http://x\')"/></g>');
    expect(s).not.toMatch(/script|onclick|http/);
    expect(s).toContain('url(#g)');
  });
  it('normalizes root element', () => {
    expect(normalizeSvg('```svg\n<svg viewBox="0 0 10 10"><rect/></svg>\n```', 512, 512)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" xmlns:xlink="[^"]+" viewBox="0 0 10 10" width="512"/);
    expect(() => normalizeSvg('<svg><g></svg>', 10, 10)).toThrow(/well-formed/);
    expect(() => normalizeSvg('nope', 10, 10)).toThrow();
  });
});
