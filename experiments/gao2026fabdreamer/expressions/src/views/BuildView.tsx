import type { ViewProps } from '../App.tsx';

/** Shows the products of Process 4 (items, style, per-layer peel rounds) and Process 5 (mask quality, fallbacks). */
export function BuildView({ state, jobs, goto }: ViewProps) {
  const img = (id?: string) => state.workImages.find((w) => w.id === id);
  const running = jobs.busy && jobs.job?.kind === 'p4';
  return (
    <div className="stack">
      {running && <div className="card notice"><span className="spinner" /> Decomposing the image layer by layer… see the trace on the right.</div>}
      {state.style && (
        <div className="card">
          <h2>Style</h2>
          <p>{state.style}</p>
        </div>
      )}
      {state.layerItems.length > 0 && (
        <div className="card">
          <h2>Items</h2>
          <div className="chips">
            {state.layerItems.map((i) => (
              <span key={i.id} className="chip" title={i.description}>
                <span className="swatch" style={{ background: i.color }} /> {i.name} <span className="muted">· {i.layerId}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {state.rounds.map((r, k) => {
        const before = img(r.workImageBefore);
        const after = img(r.workImageAfter);
        const segs = state.canvas?.segments.filter((s) => r.segmentIds.includes(s.id)) ?? [];
        return (
          <div className="card" key={k}>
            <h2>
              Round {k + 1}: {r.layerName}
            </h2>
            <div className="round">
              <figure>
                {before && <img src={before.png} alt="work image before" />}
                <figcaption>work image</figcaption>
              </figure>
              <figure>
                <svg viewBox="0 0 512 512" className="segpreview">
                  {before && <image href={before.png} width="512" height="512" opacity="0.25" />}
                  {segs.map((s) => (
                    <path key={s.id} d={s.path} fill={s.color} stroke="#000" strokeWidth="1" fillRule="evenodd" />
                  ))}
                </svg>
                <figcaption>segments cut for this layer</figcaption>
              </figure>
              {after && (
                <figure>
                  <img src={after.png} alt="work image after" />
                  <figcaption>after removal + fill</figcaption>
                </figure>
              )}
            </div>
            {r.maskQuality.length > 0 && (
              <table className="small">
                <thead>
                  <tr>
                    <th>item</th>
                    <th>detection prompt</th>
                    <th>area</th>
                    <th>parts</th>
                    <th>quality</th>
                  </tr>
                </thead>
                <tbody>
                  {r.maskQuality.map((q) => (
                    <tr key={q.itemId}>
                      <td>{q.label}</td>
                      <td className="muted">{r.detectionPrompts.find((p) => p.itemId === q.itemId)?.prompt}</td>
                      <td>{(q.areaFraction * 100).toFixed(1)}%</td>
                      <td>{q.components}</td>
                      <td className={q.ok ? 'ok' : 'bad'}>
                        {q.ok ? 'ok' : q.reasons.join('; ')}
                        {r.fallbackUsed.includes(q.itemId) && <span className="chip warn">fallback: isolated redraw</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.fillPrompt && (
              <p className="small">
                <strong>Fill prompt:</strong> {r.fillPrompt}
              </p>
            )}
          </div>
        );
      })}
      {state.canvas && !running && (
        <button className="primary" onClick={() => goto('canvas')}>
          Open the layered canvas →
        </button>
      )}
    </div>
  );
}
