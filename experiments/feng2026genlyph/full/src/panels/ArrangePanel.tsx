// Process 7 — Arrange and style the visualization; Process 8 — Export final visualization
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Section, Step } from '../components';
import { useStore } from '../store';
import { download, exportPng, type ExportScale } from '../tools/exportPng';
import { composeFgv } from '../tools/fgv';
import { axesFor, LAYOUT_LABELS, recommendLayout } from '../tools/tool4';
import type { Layout, LayoutType, Theme } from '../types';
import { useGlyphs } from '../useGlyphs';

export function ArrangePanel() {
  const { s, set } = useStore();
  const glyphs = useGlyphs();
  const host = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ row: number; dx: number; dy: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const ps = s.placement;
  const attrs = s.attributes.filter((a) => a.usable);

  // [tool_4 match] runs whenever placement_settings_1 changes
  const recommendation = useMemo(() => recommendLayout(ps, s.attributes), [ps.emphasis, s.attributes]);
  useEffect(() => {
    // keep the user's layout when returning to this panel with unchanged emphasis
    if (s.layout && JSON.stringify(s.recommendation) === JSON.stringify(recommendation)) return;
    set({ recommendation });
    // [human select] default: the recommended layout (the user can pick an alternative)
    chooseLayout(recommendation.recommended);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation]);

  function chooseLayout(type: LayoutType) {
    set((st) => {
      const prev = st.layout;
      const axes = axesFor(type, st.placement, st.attributes);
      const layout: Layout = {
        type, ...axes,
        glyphSize: prev?.glyphSize ?? 64,
        spacing: prev?.spacing ?? 8,
        width: prev?.width ?? 960,
        labelColumn: prev ? prev.labelColumn : st.dataset!.columns[0],
        showAxes: prev?.showAxes ?? true,
        title: prev?.title ?? st.dataset!.name,
        overrides: {},
      };
      return { layout };
    });
  }

  const layout = s.layout;
  const patch = (u: Partial<Layout>) => set((st) => ({ layout: { ...st.layout!, ...u } }));

  // [tool_3 compose] -> fgv_1
  const fgv = useMemo(() => (glyphs && layout ? composeFgv(glyphs, s.dataset!, s.attributes, layout, ps) : null), [glyphs, layout, s.dataset, s.attributes, ps]);

  const toSvg = (e: PointerEvent) => {
    const svg = host.current?.querySelector('svg');
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  function onDown(e: PointerEvent<HTMLDivElement>) {
    const g = (e.target as Element).closest('.glyph');
    if (!g || !fgv) return;
    const row = Number(g.getAttribute('data-row'));
    const p = toSvg(e);
    const c = fgv.centers[row];
    host.current!.setPointerCapture(e.pointerId);
    setDrag({ row, dx: c.x - p.x, dy: c.y - p.y });
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag || !layout) return;
    const p = toSvg(e);
    patch({ overrides: { ...layout.overrides, [drag.row]: { x: p.x + drag.dx, y: p.y + drag.dy } } });
  }

  function toggleEmphasis(name: string) {
    const has = ps.emphasis.includes(name);
    if (!has && ps.emphasis.length >= 2) return; // at most two emphasised attributes
    set({ placement: { ...ps, emphasis: has ? ps.emphasis.filter((x) => x !== name) : [...ps.emphasis, name] } });
  }

  // Process 8: [human specify] export_request_1 -> [tool_3 translate] fgv_png_1
  async function onExport(scale: ExportScale) {
    if (!fgv) return;
    setExporting(true);
    setExportError(undefined);
    try {
      download(await exportPng(fgv, scale), `${(s.layout?.title || 'figurative-glyphs').replace(/[^\w-]+/g, '_')}@${scale}x.png`);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="panel">
      <div className="two-col narrow-left">
        <div>
          <Section title="Style & emphasis" hint={<>Choose a visual style and up to two attributes to emphasise. <Step>human specify</Step></>}>
            <div className="seg">
              {(['light', 'dark', 'paper'] as Theme[]).map((t) => (
                <button key={t} className={ps.theme === t ? 'on' : ''} onClick={() => set({ placement: { ...ps, theme: t } })}>{t}</button>
              ))}
            </div>
            <div className="chips">
              {attrs.map((a) => (
                <button key={a.name} className={`chip ${ps.emphasis.includes(a.name) ? 'on' : ''}`}
                  disabled={!ps.emphasis.includes(a.name) && ps.emphasis.length >= 2} onClick={() => toggleEmphasis(a.name)}>
                  {a.name} <span className={`kind ${a.kind}`}>{a.kind === 'numerical' ? '#' : 'A'}</span>
                </button>
              ))}
            </div>
          </Section>
          <Section title="Placement" hint={<>Recommended by the rule-based placer <Step>tool_4 match</Step>; select one <Step>human select</Step>.</>}>
            <p className="rationale">{recommendation.rationale}</p>
            <div className="layouts">
              {recommendation.alternatives.map((t) => (
                <button key={t} className={`layoutopt ${layout?.type === t ? 'on' : ''}`} onClick={() => chooseLayout(t)}>
                  {LAYOUT_LABELS[t]} {t === recommendation.recommended && <span className="badge">recommended</span>}
                </button>
              ))}
            </div>
          </Section>
          {layout && (
            <Section title="Layout & display" hint={<>Adjust and drag glyphs on the canvas. <Step>human modify</Step></>}>
              <label className="slider">Glyph size <input type="range" min={24} max={200} value={layout.glyphSize} onChange={(e) => patch({ glyphSize: +e.target.value })} /> {layout.glyphSize}px</label>
              <label className="slider">Spacing <input type="range" min={0} max={60} value={layout.spacing} onChange={(e) => patch({ spacing: +e.target.value })} /> {layout.spacing}px</label>
              <label className="slider">Canvas width <input type="range" min={480} max={2000} step={20} value={layout.width} onChange={(e) => patch({ width: +e.target.value })} /> {layout.width}px</label>
              <label>Title <input value={layout.title} onChange={(e) => patch({ title: e.target.value })} /></label>
              <label>Labels
                <select value={layout.labelColumn ?? ''} onChange={(e) => patch({ labelColumn: e.target.value || null })}>
                  <option value="">none</option>
                  {s.dataset!.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label><input type="checkbox" checked={layout.showAxes} onChange={(e) => patch({ showAxes: e.target.checked })} /> Show axes</label>
              <button className="small" disabled={Object.keys(layout.overrides).length === 0} onClick={() => patch({ overrides: {} })}>Reset dragged glyphs</button>
            </Section>
          )}
          <Section title="Export" hint={<>Render the finished visualization as PNG. <Step>human specify → tool_3 translate</Step></>}>
            <div className="seg">
              {([1, 2, 4] as ExportScale[]).map((k) => <button key={k} disabled={!fgv || exporting} onClick={() => onExport(k)}>PNG {k}×</button>)}
            </div>
            {exportError && <p className="error">⚠ {exportError}</p>}
          </Section>
        </div>
        <Section title="Figurative glyph visualization">
          <div className="fgvhost" ref={host} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => setDrag(null)}
            dangerouslySetInnerHTML={{ __html: fgv?.svg ?? '' }} />
        </Section>
      </div>
    </div>
  );
}
