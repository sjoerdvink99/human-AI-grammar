import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import type { ViewProps } from '../App.tsx';
import type { MaterialSettings } from '../../shared/types.ts';
import { renderPreview } from '../preview.ts';

const FIELDS: { key: keyof MaterialSettings; label: string; step?: number }[] = [
  { key: 'thicknessMm', label: 'Sheet thickness (mm)', step: 0.1 },
  { key: 'artworkWidthMm', label: 'Artwork width (mm)' },
  { key: 'sheetWidthMm', label: 'Sheet width (mm)' },
  { key: 'sheetHeightMm', label: 'Sheet height (mm)' },
  { key: 'minFeatureMm', label: 'Min. feature width (mm)', step: 0.1 },
  { key: 'minPartAreaMm2', label: 'Min. part area (mm²)' },
  { key: 'maxLayers', label: 'Max. layers' },
];

/** Process 10: settings → check (tool_3) → report (model_4) → choose resolution → fix call → execute → re-check. */
export function FabricationView({ state, jobs, refresh }: ViewProps) {
  const [settings, setSettings] = useState<MaterialSettings>(state.materialSettings);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [hover, setHover] = useState<string | null>(null);
  const busy = jobs.busy;
  useEffect(() => setSettings(state.materialSettings), [state.materialSettings]);
  const dirty = JSON.stringify(settings) !== JSON.stringify(state.materialSettings);
  const canvas = state.canvas!;
  const preview = useMemo(() => renderPreview(canvas), [canvas]);
  const hovered = canvas.segments.find((s) => s.id === hover);

  const check = async () => {
    if (dirty) await api('/material', settings, 'PUT');
    await refresh();
    jobs.run('/check');
  };

  return (
    <div className="split3">
      <div className="card stack">
        <h2>Material</h2>
        <label>Material</label>
        <select value={settings.material} onChange={(e) => setSettings({ ...settings, material: e.target.value as MaterialSettings['material'] })}>
          {['cardstock', 'plywood', 'acrylic', 'mdf', 'felt'].map((m) => <option key={m}>{m}</option>)}
        </select>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label>{f.label}</label>
            <input type="number" step={f.step ?? 1} value={settings[f.key] as number} onChange={(e) => setSettings({ ...settings, [f.key]: +e.target.value })} />
          </div>
        ))}
        <button className="primary" disabled={busy} onClick={check}>{dirty ? 'Save & check' : 'Check constraints'}</button>
      </div>

      <div className="card stack">
        <h2>Issues {state.constraintIssues.length > 0 && <span className="chip">{state.constraintIssues.length}</span>}</h2>
        {state.constraintIssues.length === 0 && <p className="muted">{state.constraintReport ? 'No issues found.' : 'Run a check to see issues.'}</p>}
        {state.constraintIssues.map((i) => (
          <div key={i.id} className={`issue ${i.severity}`} onMouseEnter={() => setHover(i.segmentId ?? null)} onMouseLeave={() => setHover(null)}>
            <div className="row between">
              <strong>{i.type.replace(/_/g, ' ')}</strong>
              <span className="chip">{i.severity}</span>
            </div>
            <p className="small">{i.message}</p>
            {i.options.length > 0 && (
              <div className="row wrap">
                {i.options.map((o) => (
                  <label key={o.id} className="radio small">
                    <input type="radio" name={i.id} checked={choice[i.id] === o.id} onChange={() => setChoice({ ...choice, [i.id]: o.id })} /> {o.label}
                  </label>
                ))}
                <button disabled={busy || !choice[i.id]} onClick={() => jobs.run('/fix', { issueId: i.id, optionId: choice[i.id] })}>Apply</button>
              </div>
            )}
          </div>
        ))}
        {state.lastFixCall && (
          <p className="small muted">
            Last fix call: <code>{state.lastFixCall.tool}({JSON.stringify(state.lastFixCall.args)})</code>
            {state.lastFixCall.explanation ? ` — ${state.lastFixCall.explanation}` : ''}
          </p>
        )}
      </div>

      <div className="stack">
        <div className="card">
          <h2>Advisor report</h2>
          {busy && jobs.job?.kind === 'p10' && !state.constraintReport && <p><span className="spinner" /> Writing report…</p>}
          {state.constraintReport ? <p className="report">{state.constraintReport}</p> : <p className="muted small">The report appears after a check.</p>}
        </div>
        <div className="card">
          <h3>Canvas</h3>
          <div className="preview rel">
            <div dangerouslySetInnerHTML={{ __html: preview }} />
            {hovered && (
              <svg viewBox="0 0 512 512" className="overlay">
                <path d={hovered.path} transform={`translate(${hovered.dx} ${hovered.dy})`} fill="#ff2d6f55" stroke="#ff2d6f" strokeWidth="3" fillRule="evenodd" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
