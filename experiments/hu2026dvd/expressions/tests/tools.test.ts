import { describe, expect, it } from 'vitest';
import { seedProject } from '../server/seed';
import { sanitizeSvg } from '../server/operations';
import { ScriptsOutputSchema } from '../shared/schemas';
import { composeVideoRequest, sceneAt } from '../src/video/compose';
import { retrieveFocus } from '../src/tools/retrieve';
import { composeClipRequest } from '../src/tools/clipRequest';
import { parseCsv, translateChart, validateChartData } from '../src/video/chart';
import { fitBox } from '../src/views/ComposeView';

const p = seedProject();
const scenes = p.references.flatMap((r) => r.scenes ?? []);

describe('tool_1 compose', () => {
  it('lays scenes out back to back', () => {
    const req = composeVideoRequest(scenes);
    expect(req.scenes[0].start).toBe(0);
    expect(req.scenes[1].start).toBe(req.scenes[0].end);
    expect(req.totalSec).toBe(scenes.reduce((a, s) => a + s.durationSec, 0));
    expect(sceneAt(req, req.scenes[1].start + 0.1).scene.id).toBe(scenes[1].id);
  });
  it('rejects empty scripts', () => expect(() => composeVideoRequest([])).toThrow());
  it('builds a clip request from one scene', () => {
    const r = composeClipRequest(scenes[0]);
    expect(r.sceneId).toBe(scenes[0].id);
    expect(r.palette.accent).toBe(scenes[0].accent);
  });
});

describe('tool_3 select', () => {
  it('finds the comparison reference for a comparison scene', () => {
    const scene = { ...scenes[0], id: 'q', title: 'Before and after', visual: { kind: 'comparison' as const, label: 'capacity then vs now', value: '', items: [] } };
    const f = retrieveFocus(scene, p.guidelines, p.references);
    expect(f.references[0].item.id).toBe('r2');
    expect(f.guideline?.item.id).toBe('g4');
    expect(f.references).toHaveLength(3);
  });
});

describe('tool_4 translate', () => {
  it('validates numeric data', () => {
    expect(validateChartData(p.chartData)).toBeNull();
    expect(validateChartData({ columns: ['a', 'b'], rows: [['x', 'y']] })).toMatch(/not a number/);
  });
  it('parses CSV', () => {
    const d = parseCsv('Year,Solar\n2010,40\n2020,700');
    expect(d.rows[1]).toEqual(['2020', 700]);
    expect(translateChart(d, 'race').durationSec).toBeGreaterThanOrEqual(3);
  });
});

describe('model output handling', () => {
  it('sanitizes generated SVG', () => {
    const s = sanitizeSvg('here: <svg viewBox="0 0 1 1" onload="x()"><script>alert(1)</script><image href="http://evil/x.png"/></svg> done');
    expect(s).not.toMatch(/script|onload|evil/);
    expect(s.startsWith('<svg')).toBe(true);
  });
  it('rejects malformed scripts', () => {
    expect(ScriptsOutputSchema.safeParse({ scenes: [{ title: 'x' }] }).success).toBe(false);
  });
  it('keeps the chart box readable and inside the frame', () => {
    const b = fitBox({ x: 0.95, y: 0.9, w: 0.02, h: 0.02 });
    expect(b.x + b.w).toBeLessThanOrEqual(1);
    expect(b.w).toBeGreaterThanOrEqual(0.32);
  });
});
