import { actions, useStore } from '../store';
import { Spinner, Svg } from '../components/common';
import { glyphSvg } from '../tools/assemble';
import { layoutName } from '../tools/layout';
import { exportFGV } from '../tools/export';
import type { NumericChannel, LayoutType } from '../types';

/** Process 5: fragments -> descriptions -> encoding prompts -> categorical fragments (prompt-edit loop) */
export function FragmentsView() {
  const s = useStore();
  if (!s.fragments.length) return <p className="panel">Build fragments from the mapped masks first.</p>;
  const anyPending = s.encodingVariants.some((v) => v.status === 'pending');
  return (
    <section className="panel">
      <h2>Fragments &amp; categorical encodings</h2>
      <div className="row">
        <button className="primary" disabled={!s.encodingVariants.length || anyPending} onClick={actions.generateAllVariants}>
          Generate all missing variants
        </button>
        {s.busy.describe && <Spinner label=" describing fragments…" />}
        <button className="primary" disabled={anyPending || s.busy.describe || s.busy.contours} onClick={actions.extractContours}>
          Assemble glyphs →
        </button>
      </div>
      {s.fragments.map((f) => {
        const vs = s.encodingVariants.filter((v) => v.maskId === f.maskId);
        const maps = s.attributeMappings.filter((m) => m.maskId === f.maskId);
        return (
          <div key={f.maskId} className="fragment">
            <div className="fragment-head">
              <Svg svg={f.svg} size={96} className="checker" />
              <div>
                <b>{f.name}</b> · {maps.map((m) => `${m.attribute} (${m.kind})`).join(', ')}
                <div className="muted small">edge: x {f.edge.x.toFixed(0)}, y {f.edge.y.toFixed(0)}, {f.edge.w.toFixed(0)}×{f.edge.h.toFixed(0)}</div>
                <div>{f.description ?? (s.busy.describe ? <Spinner /> : '')}</div>
              </div>
            </div>
            {vs.length > 0 && (
              <div className="variants">
                {vs.map((v) => (
                  <div key={v.value} className="variant">
                    <div className="vhead"><b>{v.value}</b>
                      {v.versions.length > 1 && (
                        <select value={v.current} onChange={(e) => actions.setVariantVersion(v.maskId, v.value, Number(e.target.value))}>
                          {v.versions.map((_, i) => <option key={i} value={i}>v{i + 1}</option>)}
                        </select>
                      )}
                    </div>
                    {v.status === 'pending' ? <div className="ph"><Spinner /></div>
                      : v.versions.length ? <Svg svg={v.versions[v.current]} size={110} className="checker" />
                        : <div className="ph muted small">{v.status === 'error' ? v.error : 'not generated'}</div>}
                    <textarea rows={4} value={v.prompt} onChange={(e) => actions.setEncodingPrompt(v.maskId, v.value, e.target.value)} />
                    <button className="small" disabled={v.status === 'pending'} onClick={() => actions.generateVariant(v.maskId, v.value)}>
                      {v.versions.length ? 'Regenerate' : 'Generate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

const CHANNELS: NumericChannel[] = ['scale', 'stretchY', 'stretchX', 'rotate', 'opacity', 'lightness'];
const DEFAULT_RANGE: Record<NumericChannel, [number, number]> = {
  scale: [0.5, 1.4], stretchY: [0.4, 1.5], stretchX: [0.4, 1.5], rotate: [-45, 45], opacity: [0.25, 1], lightness: [0.5, 1.4],
};

/** Process 6: contours -> assembly settings -> numerical fragments -> glyphs (settings loop) */
export function AssembleView() {
  const s = useStore();
  if (!s.glyphs.length && !s.contours.length) return <p className="panel">Assemble glyphs from the fragments first.</p>;
  const st = s.assemblySettings;
  const setNum = (attr: string, p: Partial<(typeof st.numeric)[string]>) =>
    actions.setAssembly({ numeric: { ...st.numeric, [attr]: { ...st.numeric[attr], ...p } } });
  const label = s.attributes.find((a) => a.kind === 'id')?.name;
  return (
    <div className="cols">
      <section className="panel narrow">
        <h2>Assembly settings</h2>
        <label><input type="checkbox" checked={st.showBase} onChange={(e) => actions.setAssembly({ showBase: e.target.checked })} /> show unmapped base of the glyph</label>
        {Object.entries(st.numeric).map(([attr, cfg]) => (
          <fieldset key={attr}>
            <legend>{attr} → {s.masks.find((m) => s.attributeMappings.some((x) => x.maskId === m.id && x.attribute === attr))?.name}</legend>
            <label>channel
              <select value={cfg.channel} onChange={(e) => {
                const channel = e.target.value as NumericChannel;
                setNum(attr, { channel, from: DEFAULT_RANGE[channel][0], to: DEFAULT_RANGE[channel][1] });
              }}>
                {CHANNELS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>min → <input type="number" step="0.05" value={cfg.from} onChange={(e) => setNum(attr, { from: Number(e.target.value) })} /></label>
            <label>max → <input type="number" step="0.05" value={cfg.to} onChange={(e) => setNum(attr, { to: Number(e.target.value) })} /></label>
            <label>anchor
              <select value={cfg.anchor} onChange={(e) => setNum(attr, { anchor: e.target.value as 'center' })}>
                <option>center</option><option>bottom</option><option>top</option>
              </select>
            </label>
          </fieldset>
        ))}
        {!Object.keys(st.numeric).length && <p className="muted small">No numeric mappings — glyphs vary by categorical fragments only.</p>}
        <button onClick={actions.extractContours} disabled={s.busy.contours}>Re-extract contours</button>
        <h3>Fragment contours</h3>
        <div className="gallery">
          {s.contours.map((c) => {
            const f = s.fragments.find((x) => x.maskId === c.maskId)!;
            return (
              <svg key={c.maskId} viewBox={s.skeleton?.viewBox} width={110} height={110} className="checker">
                <g dangerouslySetInnerHTML={{ __html: f.inner }} />
                <polygon points={c.hull.map((p) => p.join(',')).join(' ')} fill="none" stroke="#e11" strokeWidth="1.5" />
                <circle cx={c.anchor[0]} cy={c.anchor[1]} r="3" fill="#e11" />
              </svg>
            );
          })}
        </div>
        <p><button className="primary" onClick={actions.recommend}>Lay out glyphs →</button></p>
      </section>
      <section className="panel">
        <h2>Glyphs ({s.glyphs.length})</h2>
        <div className="gallery">
          {s.glyphs.map((g) => (
            <figure key={g.rowIndex}>
              <Svg svg={glyphSvg(g)} size={96} />
              <figcaption>{label ? String(s.dataset!.rows[g.rowIndex][label]) : `#${g.rowIndex + 1}`}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Processes 7 + 8: placement -> recommendation -> layout -> FGV (modify loop) -> export */
export function LayoutView() {
  const s = useStore();
  if (!s.glyphs.length) return <p className="panel">Assemble glyphs first.</p>;
  const p = s.placementSettings;
  const opt = (kinds: string[]) => [<option key="" value="">—</option>,
    ...s.attributes.filter((a) => kinds.includes(a.kind)).map((a) => <option key={a.name}>{a.name}</option>)];
  return (
    <div className="cols">
      <section className="panel narrow">
        <h2>Placement</h2>
        <label>x <select value={p.xAttr} onChange={(e) => actions.setPlacement({ xAttr: e.target.value })}>{opt(['numeric'])}</select></label>
        <label>y <select value={p.yAttr} onChange={(e) => actions.setPlacement({ yAttr: e.target.value })}>{opt(['numeric'])}</select></label>
        <label>sort by <select value={p.sortAttr} onChange={(e) => actions.setPlacement({ sortAttr: e.target.value })}>{opt(['numeric', 'categorical', 'id'])}</select></label>
        <label>group by <select value={p.groupAttr} onChange={(e) => actions.setPlacement({ groupAttr: e.target.value })}>{opt(['categorical'])}</select></label>
        <label>label <select value={p.labelAttr} onChange={(e) => actions.setPlacement({ labelAttr: e.target.value })}>{opt(['id', 'categorical', 'numeric'])}</select></label>
        <label>glyph size <input type="range" min={24} max={160} value={p.glyphSize} onChange={(e) => actions.setPlacement({ glyphSize: Number(e.target.value) })} /> {p.glyphSize}px</label>
        <label>canvas width <input type="number" step={50} value={p.width} onChange={(e) => actions.setPlacement({ width: Number(e.target.value) })} /></label>

        <h3>Recommended layouts</h3>
        {s.layoutRecommendation.map((o) => (
          <div key={o.type} className={`rec ${s.layout?.type === o.type ? 'active' : ''}`} onClick={() => actions.selectLayout(o.type)}>
            <div><b>{layoutName(o.type)}</b> <span className="score" style={{ width: o.score * 60 }} /> <small>{Math.round(o.score * 100)}%</small></div>
            <small className="muted">{o.reason}</small>
          </div>
        ))}

        {s.layout && (
          <>
            <h3>Layout</h3>
            <label>type
              <select value={s.layout.type} onChange={(e) => actions.setLayout({ type: e.target.value as LayoutType })}>
                {(['grid', 'sortedGrid', 'groupedGrid', 'scatter', 'circular'] as LayoutType[]).map((t) => <option key={t} value={t}>{layoutName(t)}</option>)}
              </select>
            </label>
            <label>padding <input type="number" value={s.layout.padding} onChange={(e) => actions.setLayout({ padding: Number(e.target.value) })} /></label>
            <label><input type="checkbox" checked={s.layout.showLabels} onChange={(e) => actions.setLayout({ showLabels: e.target.checked })} /> labels</label>
            <label><input type="checkbox" checked={s.layout.showAxes} onChange={(e) => actions.setLayout({ showAxes: e.target.checked })} /> axes (scatter)</label>
          </>
        )}
      </section>
      <section className="panel">
        <h2>Fragmented glyph visualization</h2>
        {s.fgv ? (
          <>
            <div className="row">
              <span>Export:</span>
              <button onClick={() => exportFGV(s.fgv!, 'png')}>PNG</button>
              <button onClick={() => exportFGV(s.fgv!, 'svg')}>SVG</button>
            </div>
            <div className="fgv" dangerouslySetInnerHTML={{ __html: s.fgv }} />
          </>
        ) : <p className="muted">Pick a recommended layout.</p>}
      </section>
    </div>
  );
}
