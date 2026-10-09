import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { ViewProps } from '../App.tsx';
import type { Canvas, Segment } from '../../shared/types.ts';
import { layerSvg, renderPreview, sortedLayers } from '../preview.ts';
import { GrabPanel } from './GrabPanel.tsx';

/** Process 7 (compose → preview → human modify loop) with Process 8 (repair), 9 (split) and 6 (grab) attached. */
export function CanvasView(props: ViewProps) {
  const { state, jobs, refresh } = props;
  const canvas = state.canvas!;
  const [sel, setSel] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<string | 'all'>('all');
  const [splitReq, setSplitReq] = useState('');
  const [mode, setMode] = useState<'flat' | 'exploded'>('flat');
  const [local, setLocal] = useState<Canvas>(canvas);
  const busy = jobs.busy;
  useEffect(() => setLocal(canvas), [canvas]);

  const op = async (body: object) => {
    await api('/canvas/op', body);
    await refresh();
  };
  const layers = sortedLayers(local);
  const selected = local.segments.find((s) => s.id === sel) ?? null;
  const preview = useMemo(() => renderPreview(local), [local]);

  // ---- drag (human modify on the spatial canvas) ----
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; dx0: number; dy0: number; moved: boolean } | null>(null);
  const toSvg = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * local.width, y: ((e.clientY - r.top) / r.height) * local.height };
  };
  const onDown = (e: React.PointerEvent, s: Segment) => {
    e.stopPropagation();
    setSel(s.id);
    if (s.source === 'background') return;
    const p = toSvg(e);
    drag.current = { id: s.id, sx: p.x, sy: p.y, dx0: s.dx, dy0: s.dy, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e);
    const dx = Math.round(d.dx0 + p.x - d.sx), dy = Math.round(d.dy0 + p.y - d.sy);
    d.moved = true;
    setLocal((c) => ({ ...c, segments: c.segments.map((s) => (s.id === d.id ? { ...s, dx, dy } : s)) }));
  };
  const onUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const s = local.segments.find((x) => x.id === d.id)!;
    await op({ op: 'move', id: d.id, dx: s.dx, dy: s.dy });
  };

  const visible = (s: Segment) => {
    const l = layers.find((x) => x.id === s.layerId);
    return l?.visible && (activeLayer === 'all' || activeLayer === s.layerId);
  };
  const ordered = layers.flatMap((l) => local.segments.filter((s) => s.layerId === l.id));

  return (
    <div className="canvasgrid">
      <div className="card layerpanel">
        <h3>Layers</h3>
        <button className={`layerbtn ${activeLayer === 'all' ? 'active' : ''}`} onClick={() => setActiveLayer('all')}>
          All layers
        </button>
        {[...layers].reverse().map((l) => (
          <div key={l.id} className={`layerrow ${activeLayer === l.id ? 'active' : ''}`}>
            <button className="icon" title="show/hide" onClick={() => op({ op: 'toggleLayer', layerId: l.id })}>
              {l.visible ? '◉' : '○'}
            </button>
            <button className="layerbtn" onClick={() => setActiveLayer(l.id)} onDoubleClick={() => {
              const name = prompt('Rename layer', l.name);
              if (name) op({ op: 'renameLayer', layerId: l.id, name });
            }}>
              {l.name} <span className="muted small">({local.segments.filter((s) => s.layerId === l.id).length})</span>
            </button>
            <button className="icon" title="bring forward" onClick={() => op({ op: 'moveLayer', layerId: l.id, dir: 1 })}>▲</button>
            <button className="icon" title="send back" onClick={() => op({ op: 'moveLayer', layerId: l.id, dir: -1 })}>▼</button>
          </div>
        ))}
        <button className="ghost small" onClick={() => { const n = prompt('Layer name'); if (n) op({ op: 'addLayer', name: n }); }}>+ Add layer</button>
        <hr />
        <div className="row">
          <button className="ghost" disabled={state.canvasHistoryLength === 0} onClick={() => api('/canvas/undo', {}).then(refresh)}>
            ↶ Undo
          </button>
          <span className="small muted">v{canvas.version} · {canvas.note}</span>
        </div>
      </div>

      <div className="card editor">
        <div className="row between">
          <h3>Canvas</h3>
          <span className="small muted">Drag pieces to move them. Click to select.</span>
        </div>
        <svg ref={svgRef} viewBox={`0 0 ${local.width} ${local.height}`} className="editsvg" onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => setSel(null)}>
          <rect width={local.width} height={local.height} fill="#fff" />
          {ordered.map((s) =>
            visible(s) ? (
              <path
                key={s.id}
                d={s.path}
                transform={`translate(${s.dx} ${s.dy})`}
                fill={s.color}
                fillRule="evenodd"
                stroke={s.id === sel ? '#ff2d6f' : '#0002'}
                strokeWidth={s.id === sel ? 3 : 1}
                style={{ cursor: s.source === 'background' ? 'default' : 'move' }}
                onPointerDown={(e) => onDown(e, s)}
              >
                <title>{s.label}</title>
              </path>
            ) : null,
          )}
        </svg>
      </div>

      <div className="stack sidepanel">
        <div className="card">
          <h3>Selected piece</h3>
          {!selected && <p className="muted small">Select a piece on the canvas.</p>}
          {selected && (
            <div className="stack">
              <div>
                <strong>{selected.label}</strong> <span className="chip">{selected.source}</span>
              </div>
              <label>Layer</label>
              <select value={selected.layerId} onChange={(e) => op({ op: 'setLayer', id: selected.id, layerId: e.target.value })}>
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <label>Colour</label>
              <input type="color" value={selected.color} onChange={(e) => setLocal((c) => ({ ...c, segments: c.segments.map((s) => (s.id === selected.id ? { ...s, color: e.target.value } : s)) }))} onBlur={(e) => op({ op: 'setColor', id: selected.id, color: e.target.value })} />
              <label>Size</label>
              <div className="row">
                <button className="ghost" onClick={() => op({ op: 'scale', id: selected.id, factor: 0.8 })}>− Smaller</button>
                <button className="ghost" onClick={() => op({ op: 'scale', id: selected.id, factor: 1.25 })}>+ Larger</button>
              </div>
              <div className="row">
                <button className="ghost" onClick={() => op({ op: 'move', id: selected.id, dx: 0, dy: 0 })} disabled={!selected.dx && !selected.dy}>Reset position</button>
                <button className="danger" onClick={() => op({ op: 'delete', id: selected.id }).then(() => setSel(null))}>Delete</button>
              </div>
              <hr />
              <label>Repair from source image</label>
              <p className="small muted">Redraws this piece cleanly and completes hidden parts, using the source image around it.</p>
              <button disabled={busy || !state.sourceImages.length} onClick={() => jobs.run('/canvas/repair', { segmentId: selected.id })}>Repair piece</button>
              <hr />
              <label>Split into parts</label>
              <textarea rows={2} value={splitReq} onChange={(e) => setSplitReq(e.target.value)} placeholder="e.g. separate the trunk from the crown" />
              <button disabled={busy || !splitReq.trim()} onClick={() => jobs.run('/canvas/split', { segmentId: selected.id, request: splitReq }).then(() => setSplitReq(''))}>Split piece</button>
            </div>
          )}
        </div>
        <div className="card">
          <div className="row between">
            <h3>Preview</h3>
            <div className="seg">
              <button className={mode === 'flat' ? 'active' : ''} onClick={() => setMode('flat')}>Front</button>
              <button className={mode === 'exploded' ? 'active' : ''} onClick={() => setMode('exploded')}>Exploded</button>
            </div>
          </div>
          {mode === 'flat' ? (
            <div className="preview" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <div className="exploded">
              {layers.filter((l) => l.visible).map((l, i) => (
                <div key={l.id} className="sheet" style={{ transform: `rotateX(55deg) rotateZ(-35deg) translateZ(${i * 28}px)` }} dangerouslySetInnerHTML={{ __html: layerSvg(local, l, { outline: true }) }} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grabrow">
        <GrabPanel {...props} activeLayer={activeLayer === 'all' ? layers.at(-1)?.id : activeLayer} />
      </div>
    </div>
  );
}
