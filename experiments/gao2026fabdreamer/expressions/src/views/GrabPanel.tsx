import { useState } from 'react';
import { api } from '../api.ts';
import type { ViewProps } from '../App.tsx';

/** Process 6: grab request → candidates → select → occlusion check → isolated redraw → mask → element. */
export function GrabPanel({ state, jobs, refresh, activeLayer }: ViewProps & { activeLayer?: string }) {
  const [req, setReq] = useState(state.grab.request ?? '');
  const g = state.grab;
  const busy = jobs.busy;
  const layers = state.canvas ? [...state.canvas.layers].sort((a, b) => b.depth - a.depth) : [];
  const [target, setTarget] = useState<string | undefined>(activeLayer);
  const layerId = target ?? activeLayer ?? layers[0]?.id;
  return (
    <div className="card">
      <h3>Grab a new element</h3>
      <p className="small muted">Generate an extra element (e.g. "a perched owl"), pick one, and it is cut out as a piece you can place on a layer.</p>
      <div className="row">
        <input value={req} onChange={(e) => setReq(e.target.value)} placeholder="Describe an element to add" style={{ flex: 1 }} />
        <button disabled={busy || !req.trim()} onClick={() => jobs.run('/grab/generate', { request: req })}>Generate</button>
      </div>
      {g.candidates.length > 0 && (
        <div className="grabflow">
          <div>
            <div className="small muted">Candidates — click one</div>
            <div className="gallery small">
              {g.candidates.map((c) => (
                <button key={c.id} className={`thumb ${g.image?.id === c.id ? 'chosen' : ''}`} disabled={busy} onClick={() => jobs.run('/grab/select', { id: c.id })}>
                  <img src={c.png} alt="" />
                </button>
              ))}
            </div>
          </div>
          {g.occlusion && (
            <div>
              <div className="small muted">Occlusion check</div>
              <div className={`chip ${g.occlusion === 'complete' ? '' : 'warn'}`}>{g.occlusion}</div>
              <p className="small">{g.occlusionReason}</p>
            </div>
          )}
          {g.isolated && (
            <div>
              <div className="small muted">Isolated redraw</div>
              <img className="mini" src={g.isolated.png} alt="" />
            </div>
          )}
          {g.element && (
            <div>
              <div className="small muted">Cut piece</div>
              <svg viewBox="0 0 512 512" className="mini">
                <path d={g.element.path} fill={g.element.color} fillRule="evenodd" />
              </svg>
            </div>
          )}
        </div>
      )}
      {state.grabbedElements.length > 0 && (
        <>
          <hr />
          <div className="row">
            <span className="small">Grabbed pieces — place on</span>
            <select value={layerId} onChange={(e) => setTarget(e.target.value)}>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="gallery small">
            {state.grabbedElements.map((s) => (
              <button key={s.id} className="thumb" title={`Place "${s.label}"`} disabled={!layerId} onClick={() => api('/canvas/op', { op: 'placeGrab', grabId: s.id, layerId }).then(refresh)}>
                <svg viewBox={`${s.bbox.x} ${s.bbox.y} ${s.bbox.w} ${s.bbox.h}`}>
                  <path d={s.path} fill={s.color} fillRule="evenodd" />
                </svg>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
