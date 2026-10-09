import { useState } from 'react';
import { api } from '../api.ts';
import type { ViewProps } from '../App.tsx';

/** Process 1 (prompt → candidates → select) and Process 2 (specify update → modify). */
export function ImageView({ state, jobs, refresh, goto }: ViewProps) {
  const [prompt, setPrompt] = useState(state.prompt ?? '');
  const [update, setUpdate] = useState('');
  const source = state.sourceImages.at(-1);
  const busy = jobs.busy;

  const select = async (id: string) => {
    if (source && !confirm('Use this image as the new source? Layer plan, decomposition and canvas will be reset.')) return;
    await api('/images/select', { id });
    await refresh();
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Describe the scene</h2>
        <p className="muted small">The image will be cut into depth layers, so scenes with a clear foreground, middle ground and background work best.</p>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A fox in a pine forest at dusk, mountains and a large moon behind" />
        <div className="row">
          <button disabled={busy || !prompt.trim()} onClick={() => jobs.run('/images/generate', { prompt })}>
            {state.imageCandidates.length ? 'Generate new candidates' : 'Generate candidates'}
          </button>
        </div>
      </div>

      {(state.imageCandidates.length > 0 || (busy && jobs.job?.kind === 'p1')) && (
        <div className="card">
          <h2>Candidates</h2>
          <p className="muted small">Pick one to work with.</p>
          <div className="gallery">
            {busy && jobs.job?.kind === 'p1' && [0, 1, 2].map((i) => <div key={i} className="thumb placeholder"><span className="spinner" /></div>)}
            {!(busy && jobs.job?.kind === 'p1') &&
              state.imageCandidates.map((c) => (
                <button key={c.id} className={`thumb ${source && state.sourceImages[0]?.id === c.id ? 'chosen' : ''}`} onClick={() => select(c.id)} disabled={busy}>
                  <img src={c.png} alt={c.note} />
                  <span>{c.note}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {source && (
        <div className="card">
          <h2>Source image</h2>
          <div className="split">
            <div>
              <img className="big" src={source.png} alt="source" />
              {state.sourceImages.length > 1 && (
                <div className="versions">
                  {state.sourceImages.map((v, i) => (
                    <button key={v.id} className={`vthumb ${v.id === source.id ? 'chosen' : ''}`} title={v.note} onClick={() => v.id !== source.id && api('/images/revert', { id: v.id }).then(refresh)} disabled={busy}>
                      <img src={v.png} alt="" />
                      <span>v{i + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="stack">
              <label>Change something in the image</label>
              <textarea rows={3} value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="e.g. make the moon bigger and add birds in the sky" />
              <button disabled={busy || !update.trim()} onClick={() => jobs.run('/images/modify', { update }).then(() => setUpdate(''))}>
                Apply change
              </button>
              {state.imageUpdates.length > 0 && (
                <div className="small muted">
                  Edits so far:
                  <ol>{state.imageUpdates.map((u, i) => <li key={i}>{u}</li>)}</ol>
                </div>
              )}
              <hr />
              <button className="primary" disabled={busy} onClick={() => goto('plan')}>
                Continue to the layer plan →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
