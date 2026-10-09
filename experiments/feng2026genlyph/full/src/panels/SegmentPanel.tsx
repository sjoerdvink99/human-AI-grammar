// Process 4 — Segment and map glyph components
import { useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import { Section, Spinner, Step } from '../components';
import { uid, useStore, type PendingRegion } from '../store';
import { boxesIntersect, glyphImageSvg } from '../tools/svg';
import { setAttr } from '../tools/tool2';
import type { BBox, Mask } from '../types';

const MASK_COLORS = ['#4363d8', '#911eb4', '#f58231', '#000075', '#42d4f4', '#f032e6', '#9a6324', '#e6194b'];

export function SegmentPanel({ onSubmit }: { onSubmit: () => void }) {
  const { s, set } = useStore();
  const gi = s.glyphImage!;
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<'draw' | 'edit'>('draw');
  const [active, setActive] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const toLocal = (e: PointerEvent) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  async function segment(region: PendingRegion) {
    const patchR = (u: Partial<PendingRegion>) => set((st) => ({ regions: st.regions.map((r) => (r.id === region.id ? { ...r, ...u } : r)) }));
    try {
      const shapes = gi.shapes.map((sh) => ({ gid: sh.gid, tag: sh.tag, bbox: sh.bbox, fill: sh.fill }));
      const res = await api.segment(glyphImageSvg(gi), shapes, region.box); // [model_3 extract]
      // enforce: a mask only contains existing shapes that intersect the box
      const gids = res.gids.filter((g) => gi.shapes.some((sh) => sh.gid === g && boxesIntersect(sh.bbox, region.box)));
      if (gids.length === 0) throw new Error('model_3 found no part inside the box — try a tighter box');
      set((st) => {
        const color = MASK_COLORS[st.masks.length % MASK_COLORS.length];
        const mask: Mask = { id: uid('mask'), name: res.name || `part ${st.masks.length + 1}`, box: region.box, gids, color };
        return {
          // a shape belongs to one mask only
          masks: [...st.masks.map((m) => ({ ...m, gids: m.gids.filter((g) => !gids.includes(g)) })), mask],
          mappings: [...st.mappings, { maskId: mask.id, categorical: null, numerical: null }],
          regions: st.regions.filter((r) => r.id !== region.id),
        };
      });
    } catch (e) {
      patchR({ status: 'error', error: (e as Error).message });
    }
  }

  function onDown(e: PointerEvent<SVGSVGElement>) {
    if (mode === 'edit') {
      const gid = (e.target as Element).closest('[data-gid]')?.getAttribute('data-gid');
      if (!gid || !active) return;
      // [human modify] masks_1 -> masks_2: toggle shape in/out of the active mask
      set((st) => ({
        masks: st.masks.map((m) => m.id === active
          ? { ...m, gids: m.gids.includes(gid) ? m.gids.filter((g) => g !== gid) : [...m.gids, gid] }
          : { ...m, gids: m.gids.filter((g) => g !== gid) }),
      }));
      return;
    }
    const p = toLocal(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onMove(e: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toLocal(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  }
  function onUp() {
    if (!drag) return;
    const box: BBox = [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)];
    setDrag(null);
    if (box[2] < 4 || box[3] < 4) return;
    // [human select] -> regions_1*
    const region: PendingRegion = { id: uid('region'), box, status: 'loading' };
    set((st) => ({ regions: [...st.regions, region] }));
    segment(region);
  }

  const setMapping = (maskId: string, key: 'categorical' | 'numerical', v: string) =>
    set((st) => ({ mappings: st.mappings.map((m) => (m.maskId === maskId ? { ...m, [key]: v || null } : m)) }));

  const masks = s.masks.filter((m) => m.gids.length > 0);
  const valid = masks.length > 0 && masks.every((m) => {
    const mp = s.mappings.find((x) => x.maskId === m.id);
    return mp && (mp.categorical || mp.numerical);
  });
  const catAttrs = s.attributes.filter((a) => a.kind === 'categorical' && a.usable);
  const numAttrs = s.attributes.filter((a) => a.kind === 'numerical');
  const vb = [gi.minX, gi.minY, gi.width, gi.height];

  return (
    <div className="panel">
      <div className="two-col wide-left">
        <Section
          title="Prototype"
          hint={mode === 'draw'
            ? <>Drag a box around a part you want to use for encoding; the segmentation model turns it into a mask. <Step>human select → model_3 extract</Step></>
            : <>Click shapes to add them to or remove them from the active mask. <Step>human modify</Step></>}
          actions={
            <div className="seg">
              <button className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>▭ Draw box</button>
              <button className={mode === 'edit' ? 'on' : ''} disabled={!active} onClick={() => setMode('edit')}>✎ Refine active mask</button>
            </div>
          }
        >
          <svg
            ref={svgRef}
            className={`segcanvas ${mode}`}
            viewBox={vb.join(' ')}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <defs dangerouslySetInnerHTML={{ __html: gi.defs }} />
            <g dangerouslySetInnerHTML={{ __html: gi.shapes.map((sh) => sh.markup).join('') }} />
            {masks.map((m) => (
              <g key={m.id} pointerEvents="none" opacity={active === m.id ? 0.9 : 0.6}>
                <defs>
                  <pattern id={`hatch-${m.id}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="8" height="8" fill="#fff" opacity="0.35" />
                    <rect width="3.5" height="8" fill={m.color} />
                  </pattern>
                </defs>
                <g dangerouslySetInnerHTML={{
                  __html: gi.shapes.filter((sh) => m.gids.includes(sh.gid))
                    .map((sh) => setAttr(setAttr(setAttr(setAttr(sh.markup, 'fill', `url(#hatch-${m.id})`), 'stroke', m.color), 'stroke-dasharray', '4 2'), 'data-gid', '')).join(''),
                }} />
              </g>
            ))}
            {s.regions.map((r) => (
              <rect key={r.id} x={r.box[0]} y={r.box[1]} width={r.box[2]} height={r.box[3]} className={`region ${r.status}`} />
            ))}
            {drag && <rect className="region drawing" x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} />}
          </svg>
          {s.regions.map((r) => (
            <div key={r.id} className="row">
              {r.status === 'loading' && <Spinner label="model_3 segmenting the box…" />}
              {r.status === 'error' && <>
                <span className="error">⚠ {r.error}</span>
                <button className="small" onClick={() => { set((st) => ({ regions: st.regions.map((x) => (x.id === r.id ? { ...x, status: 'loading' } : x)) })); segment(r); }}>Retry</button>
                <button className="small" onClick={() => set((st) => ({ regions: st.regions.filter((x) => x.id !== r.id) }))}>Dismiss</button>
              </>}
            </div>
          ))}
        </Section>

        <Section title="Components & attribute mapping" hint={<>Assign each component to a categorical attribute, a numerical attribute, or both. <Step>human assign</Step></>}>
          {masks.length === 0 && <p className="muted">No components yet. Draw a box on the prototype.</p>}
          {masks.map((m) => {
            const mp = s.mappings.find((x) => x.maskId === m.id);
            return (
              <div key={m.id} className={`maskcard ${active === m.id ? 'active' : ''}`} onClick={() => setActive(m.id)}>
                <div className="row">
                  <span className="swatch" style={{ background: m.color }} />
                  <input className="name" value={m.name} onChange={(e) => set((st) => ({ masks: st.masks.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) }))} />
                  <span className="muted">{m.gids.length} shape{m.gids.length === 1 ? '' : 's'}</span>
                  <button className="small" onClick={(e) => { e.stopPropagation(); setActive(m.id); setMode('edit'); }}>Refine</button>
                  <button className="small danger" onClick={(e) => {
                    e.stopPropagation();
                    set((st) => ({ masks: st.masks.filter((x) => x.id !== m.id), mappings: st.mappings.filter((x) => x.maskId !== m.id) }));
                    if (active === m.id) { setActive(null); setMode('draw'); }
                  }}>Delete</button>
                </div>
                <div className="row">
                  <label>Categorical
                    <select value={mp?.categorical ?? ''} onChange={(e) => setMapping(m.id, 'categorical', e.target.value)}>
                      <option value="">—</option>
                      {catAttrs.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.values.length})</option>)}
                    </select>
                  </label>
                  <label>Numerical
                    <select value={mp?.numerical ?? ''} onChange={(e) => setMapping(m.id, 'numerical', e.target.value)}>
                      <option value="">—</option>
                      {numAttrs.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
          <div className="row">
            <button className="primary" disabled={!valid || s.regions.some((r) => r.status === 'loading')} onClick={onSubmit}>
              Submit components → categorical encoding
            </button>
            {masks.length > 0 && !valid && <span className="muted">Every component needs at least one attribute.</span>}
          </div>
        </Section>
      </div>
    </div>
  );
}
