import { useEffect, useState } from 'react';
import type { ViewProps } from '../App.tsx';

/** Process 3 (plan → revise loop) and the human select of Process 4 (confirm layers → build). */
export function PlanView({ state, jobs, goto }: ViewProps) {
  const source = state.sourceImages.at(-1)!;
  const [planIdx, setPlanIdx] = useState(state.layerPlans.length - 1);
  const [change, setChange] = useState('');
  const plan = state.layerPlans[planIdx] ?? state.layerPlans.at(-1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const busy = jobs.busy;

  useEffect(() => setPlanIdx(state.layerPlans.length - 1), [state.layerPlans.length]);
  useEffect(() => {
    if (!plan) return;
    const prev = state.confirmedLayers?.layerIds;
    setChecked(new Set(plan.layers.filter((l) => !prev || prev.includes(l.id) || !state.confirmedLayers).map((l) => l.id)));
  }, [plan, state.confirmedLayers]);

  const toggle = (id: string) => {
    const n = new Set(checked);
    n.has(id) ? n.delete(id) : n.add(id);
    setChecked(n);
  };

  return (
    <div className="split">
      <div className="card">
        <h2>Source image</h2>
        <img className="big" src={source.png} alt="source" />
      </div>
      <div className="stack">
        {!plan && (
          <div className="card">
            <h2>Layer plan</h2>
            <p>Let the model propose how to split this image into stacked depth layers.</p>
            <button className="primary" disabled={busy} onClick={() => jobs.run('/plan/generate')}>
              Propose layer plan
            </button>
          </div>
        )}
        {plan && (
          <div className="card">
            <div className="row between">
              <h2>Layer plan</h2>
              {state.layerPlans.length > 1 && (
                <select value={planIdx} onChange={(e) => setPlanIdx(+e.target.value)}>
                  {state.layerPlans.map((p, i) => (
                    <option key={i} value={i}>
                      Version {i + 1}
                      {p.change ? ` — ${p.change.slice(0, 30)}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="muted small">{plan.rationale}</p>
            <p className="small">Front of the box at the top. Untick layers you don't want to build.</p>
            <ul className="layers">
              {[...plan.layers].reverse().map((l) => (
                <li key={l.id} className={checked.has(l.id) ? '' : 'off'}>
                  <label className="row">
                    <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} />
                    <span className="depth">{l.depth === 0 ? 'back' : `+${l.depth}`}</span>
                    <strong>{l.name}</strong>
                  </label>
                  <div className="small muted">{l.description}</div>
                  <div className="chips">{l.elements.map((e) => <span key={e} className="chip">{e}</span>)}</div>
                </li>
              ))}
            </ul>
            <label>Ask for a change to the plan</label>
            <textarea rows={2} value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. put the moon on its own layer; merge the two hill layers" />
            <div className="row">
              <button disabled={busy || !change.trim()} onClick={() => jobs.run('/plan/modify', { change }).then(() => setChange(''))}>
                {state.layerPlans.length > 1 ? 'Revise again' : 'Revise plan'}
              </button>
              <button disabled={busy} className="ghost" onClick={() => jobs.run('/plan/generate')}>
                Regenerate from scratch
              </button>
            </div>
            <hr />
            <button
              className="primary"
              disabled={busy || checked.size === 0 || planIdx !== state.layerPlans.length - 1}
              onClick={() => {
                jobs.run('/build', { layerIds: [...checked] });
                goto('build');
              }}
            >
              Confirm {checked.size} layers and decompose the image →
            </button>
            {planIdx !== state.layerPlans.length - 1 && <p className="small muted">Viewing an earlier version; switch to the latest to build.</p>}
            <p className="small muted">This runs many model steps (items, style, then per layer: detect, segment, fill) and takes a few minutes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
