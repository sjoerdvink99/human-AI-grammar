import { useEffect, useRef, useState } from 'react';
import { actions, useStore } from '../store';
import { Spinner } from '../components/common';
import type { Region } from '../types';
import { viewBoxOf } from '../tools/svgutil';

const SIZE = 460;

/** Process 4: select regions -> model extracts masks -> edit masks -> assign attributes */
export function SegmentView() {
  const s = useStore();
  const [mode, setMode] = useState<'region' | 'edit'>('region');
  const [drag, setDrag] = useState<Region | null>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);

  const vb = s.glyphImage ? viewBoxOf(s.glyphImage) : [0, 0, 256, 256];
  const toVb = (e: React.MouseEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [vb[0] + ((e.clientX - r.left) / r.width) * vb[2], vb[1] + ((e.clientY - r.top) / r.height) * vb[3]];
  };

  // mask overlay: colour each masked element with its mask colour
  useEffect(() => {
    const root = overlayRef.current;
    if (!root) return;
    const owner = new Map<string, { color: string; active: boolean }>();
    s.masks.forEach((m) => m.eids.forEach((e) => owner.set(e, { color: m.color, active: m.id === s.activeMask })));
    root.querySelectorAll<SVGElement>('[data-eid]').forEach((el) => {
      const o = owner.get(el.getAttribute('data-eid')!);
      el.style.fill = o ? o.color : 'none';
      el.style.stroke = o ? o.color : 'none';
      el.style.fillOpacity = o ? (o.active ? '0.6' : '0.35') : '0';
      el.style.strokeWidth = o?.active ? '2' : '1';
    });
    root.querySelectorAll<SVGElement>('stop').forEach((el) => (el.style.stopOpacity = '0'));
  }, [s.masks, s.activeMask, s.glyphImage]);

  if (!s.glyphImage) return <p className="panel">Select a glyph image first.</p>;
  const numericAttrs = s.attributes.filter((a) => a.kind === 'numeric');
  const catAttrs = s.attributes.filter((a) => a.kind === 'categorical');
  const mappingOf = (maskId: string, kind: 'categorical' | 'numeric') =>
    s.attributeMappings.find((m) => m.maskId === maskId && m.kind === kind)?.attribute || '';

  return (
    <div className="cols">
      <section className="panel">
        <h2>Segment the glyph</h2>
        <div className="row">
          <button className={mode === 'region' ? 'on' : ''} onClick={() => setMode('region')}>Draw regions</button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} disabled={!s.activeMask}>
            Edit active mask (click shapes)
          </button>
        </div>
        <div className="stage" style={{ width: SIZE, height: SIZE }}>
          <div ref={baseRef} className="layer" dangerouslySetInnerHTML={{ __html: s.glyphImage }} />
          <div ref={overlayRef} className="layer nopointer" dangerouslySetInnerHTML={{ __html: s.glyphImage }} />
          {mode === 'region' ? (
            <svg className="layer" viewBox={vb.join(' ')}
              onMouseDown={(e) => { start.current = toVb(e); setDrag(null); }}
              onMouseMove={(e) => {
                if (!start.current) return;
                const [x, y] = toVb(e), [x0, y0] = start.current;
                setDrag({ x: Math.min(x, x0), y: Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0) });
              }}
              onMouseUp={() => { if (drag && drag.w > 3 && drag.h > 3) actions.addRegion(drag); start.current = null; setDrag(null); }}>
              {[...s.regions, ...(drag ? [drag] : [])].map((r, i) => (
                <g key={i}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(30,120,255,.12)" stroke="#1e78ff" strokeDasharray="4 3" />
                  <text x={r.x + 3} y={r.y + 12} fontSize="11" fill="#1e78ff">{i < s.regions.length ? `#${i + 1}` : ''}</text>
                </g>
              ))}
            </svg>
          ) : (
            <div className="layer clickable" onClick={(e) => {
              // [human modify] masks_1 -> masks_2: hit-test the base image under the overlay
              const prev = (e.currentTarget as HTMLElement).style.pointerEvents;
              (e.currentTarget as HTMLElement).style.pointerEvents = 'none';
              const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-eid]');
              (e.currentTarget as HTMLElement).style.pointerEvents = prev;
              if (hit && baseRef.current?.contains(hit)) actions.toggleElement(hit.getAttribute('data-eid')!);
            }} />
          )}
        </div>
        <div className="row">
          <button className="primary" disabled={!s.regions.length || s.busy.segment} onClick={actions.extractMasks}>
            Extract masks from {s.regions.length} region{s.regions.length === 1 ? '' : 's'}
          </button>
          <button disabled={!s.regions.length} onClick={actions.clearRegions}>Clear regions</button>
          {s.busy.segment && <Spinner label=" segmenting…" />}
        </div>
        <p className="muted small">
          Drag rectangles over parts of the image, then extract masks. Switch to “Edit active mask” and click shapes to
          add/remove them from the active mask (masks {s.masksVersion === 2 ? 'edited (v2)' : 'as extracted (v1)'}).
        </p>
      </section>

      <section className="panel">
        <h2>Masks &amp; attribute mapping</h2>
        {!s.masks.length && <p className="muted">No masks yet.</p>}
        {s.masks.map((m) => (
          <div key={m.id} className={`mask ${m.id === s.activeMask ? 'active' : ''}`} onClick={() => actions.setActiveMask(m.id)}>
            <span className="swatch" style={{ background: m.color }} />
            <input value={m.name} onChange={(e) => actions.renameMask(m.id, e.target.value)} />
            <span className="muted small">{m.eids.length} shapes</span>
            <label>categorical
              <select value={mappingOf(m.id, 'categorical')} onChange={(e) => actions.assign(m.id, 'categorical', e.target.value)}>
                <option value="">—</option>
                {catAttrs.map((a) => <option key={a.name}>{a.name}</option>)}
              </select>
            </label>
            <label>numeric
              <select value={mappingOf(m.id, 'numeric')} onChange={(e) => actions.assign(m.id, 'numeric', e.target.value)}>
                <option value="">—</option>
                {numericAttrs.map((a) => <option key={a.name}>{a.name}</option>)}
              </select>
            </label>
            <button className="small" onClick={(e) => { e.stopPropagation(); actions.deleteMask(m.id); }}>✕</button>
          </div>
        ))}
        <p><button onClick={actions.addEmptyMask}>+ Empty mask</button></p>
        <button className="primary" disabled={!s.attributeMappings.length || s.busy.describe} onClick={actions.prepareFragments}>
          Build fragments →
        </button>
        {s.busy.describe && <Spinner label=" describing fragments…" />}
      </section>
    </div>
  );
}
