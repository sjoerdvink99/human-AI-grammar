// Process 6 — Encode numerical attributes and assemble glyphs
import { Section, Step, SvgView } from '../components';
import { useStore } from '../store';
import { glyphImageSvg } from '../tools/svg';
import { glyphSvg } from '../tools/tool3';
import type { NumericMode, PartAssembly } from '../types';
import { useGlyphs } from '../useGlyphs';

const MODES: { id: NumericMode; label: string }[] = [
  { id: 'size', label: 'Size scaling' },
  { id: 'dup-h', label: 'Horizontal duplication' },
  { id: 'dup-v', label: 'Vertical duplication' },
  { id: 'dup-path', label: 'Path (arc) duplication' },
];

export function AssemblePanel({ onNext }: { onNext: () => void }) {
  const { s, set } = useStore();
  const gi = s.glyphImage!;
  const settings = s.assembly!;
  const glyphs = useGlyphs();

  const patchPart = (maskId: string, u: Partial<PartAssembly>) =>
    set((st) => ({ assembly: { ...st.assembly!, parts: st.assembly!.parts.map((p) => (p.maskId === maskId ? { ...p, ...u } : p)) } }));
  const moveLayer = (i: number, d: number) => {
    const order = [...settings.layerOrder];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ assembly: { ...settings, layerOrder: order } });
  };
  const nameOf = (id: string) => (id === 'base' ? 'Base (unmapped shapes)' : s.masks.find((m) => m.id === id)?.name ?? id);
  const label = s.attributes.find((a) => a.kind === 'categorical' && !a.usable)?.name ?? s.dataset!.columns[0];

  return (
    <div className="panel">
      <div className="two-col narrow-left">
        <div>
          <Section title="Part contours" hint={<>Outlines used to place scaled and duplicated copies. <Step>tool_3 extract</Step></>}>
            <svg className="contours" viewBox={`${gi.minX} ${gi.minY} ${gi.width} ${gi.height}`}>
              <g opacity={0.35} dangerouslySetInnerHTML={{ __html: glyphImageSvg(gi).replace(/^<svg[^>]*>|<\/svg>$/g, '') }} />
              {s.contours.map((c) => {
                const m = s.masks.find((x) => x.id === c.maskId);
                return <polygon key={c.maskId} points={c.outline.map((p) => p.join(',')).join(' ')} fill="none" stroke={m?.color} strokeWidth={2} strokeDasharray="4 2" />;
              })}
            </svg>
          </Section>
          <Section title="Assembly settings" hint={<>How numbers change parts, spacing between copies, and layer order. Changes recompose the glyphs immediately. <Step>human specify / modify</Step></>}>
            {settings.parts.map((p) => {
              const mp = s.mappings.find((m) => m.maskId === p.maskId);
              const m = s.masks.find((x) => x.id === p.maskId);
              if (!mp?.numerical) return null;
              const dup = p.mode !== 'size';
              return (
                <div className="partset" key={p.maskId}>
                  <div className="row"><span className="swatch" style={{ background: m?.color }} /><b>{m?.name}</b><span className="muted">← {mp.numerical}</span></div>
                  <div className="seg wrap">
                    {MODES.map((md) => <button key={md.id} className={p.mode === md.id ? 'on' : ''} onClick={() => patchPart(p.maskId, { mode: md.id })}>{md.label}</button>)}
                  </div>
                  {!dup ? (
                    <div className="row">
                      <label>min scale <input type="number" step={0.1} min={0.05} value={p.minScale} onChange={(e) => patchPart(p.maskId, { minScale: Math.max(0.05, +e.target.value) })} /></label>
                      <label>max scale <input type="number" step={0.1} min={0.05} value={p.maxScale} onChange={(e) => patchPart(p.maskId, { maxScale: Math.max(0.05, +e.target.value) })} /></label>
                    </div>
                  ) : (
                    <div className="row">
                      <label>min copies <input type="number" min={0} max={30} value={p.minCount} onChange={(e) => patchPart(p.maskId, { minCount: Math.max(0, Math.min(30, Math.round(+e.target.value))) })} /></label>
                      <label>max copies <input type="number" min={1} max={30} value={p.maxCount} onChange={(e) => patchPart(p.maskId, { maxCount: Math.max(1, Math.min(30, Math.round(+e.target.value))) })} /></label>
                      <label>{p.mode === 'dup-path' ? 'angle step' : 'spacing'}
                        <input type="range" min={p.mode === 'dup-path' ? 1 : -40} max={p.mode === 'dup-path' ? 20 : 60} value={p.spacing} onChange={(e) => patchPart(p.maskId, { spacing: +e.target.value })} />
                        <span className="muted">{p.spacing}</span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
            {!settings.parts.some((p) => s.mappings.find((m) => m.maskId === p.maskId)?.numerical) && <p className="muted">No part is mapped to a numerical attribute.</p>}
            <h4>Layer order (top last)</h4>
            <ol className="layers">
              {settings.layerOrder.map((id, i) => (
                <li key={id}>
                  <span>{nameOf(id)}</span>
                  <span>
                    <button className="small" disabled={i === 0} onClick={() => moveLayer(i, -1)}>↑</button>
                    <button className="small" disabled={i === settings.layerOrder.length - 1} onClick={() => moveLayer(i, 1)}>↓</button>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
        <Section title={`Glyph preview (${glyphs?.glyphs.length ?? 0})`} hint={<>One glyph per data row. <Step>tool_3 translate → tool_3 compose</Step></>}
          actions={<button className="primary" onClick={onNext}>Continue → arrange</button>}>
          {glyphs && (
            <div className="glyphgrid">
              {glyphs.glyphs.map((g, i) => (
                <figure key={g.row}>
                  <SvgView svg={glyphSvg(glyphs, i)} className="glyph" />
                  <figcaption>{s.dataset!.rows[g.row][label]}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
