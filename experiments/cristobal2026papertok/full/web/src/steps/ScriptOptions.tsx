import { useState } from 'react';
import { api } from '../api.ts';
import type { StepProps } from '../App.tsx';

/** Process 1 results (findings, story ideas, rated hooks, shortlist) and process 2 human select. */
export function ScriptOptions({ project: p, act, onChosen }: StepProps & { onChosen: () => void }) {
  const [showWork, setShowWork] = useState(false);
  const running = p.busy?.task === 'Generating hooks and scripts';

  return (
    <section>
      <div className="section-head">
        <h2>Choose a hook and script</h2>
        <button className="ghost" disabled={!!p.busy} onClick={() => act(() => api.regenerateScripts(p.id))}>↻ Regenerate options</button>
      </div>

      {!p.scriptOptions && running && <p className="muted">The model is reading your paper. This takes a few minutes; intermediate results appear below.</p>}

      {p.scriptOptions && (
        <div className="options">
          {p.scriptOptions.map((o, i) => {
            const hook = p.hooks?.find((h) => h.text === o.hook);
            const rating = p.hookRatings?.find((r) => r.hookId === hook?.id);
            return (
              <article key={i} className={`option ${p.selectedOption === i ? 'chosen' : ''}`}>
                <div className="option-head">
                  <span className="tag">Option {i + 1}</span>
                  {rating && <span className="score" title={rating.reason}>{rating.score}/10</span>}
                </div>
                <h3>{o.title}</h3>
                <p className="hook">“{o.hook}”</p>
                <ol className="scene-list">{o.scenes.map((s, j) => <li key={j}>{s}</li>)}</ol>
                <button className="primary" disabled={!!p.busy} onClick={async () => { await act(() => api.selectScript(p.id, i)); onChosen(); }}>
                  {p.selectedOption === i ? 'Chosen ✓ (choose again)' : 'Use this script'}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {(p.findings || running) && (
        <details className="work" open={showWork || (running && !p.scriptOptions)} onToggle={(e) => setShowWork((e.target as HTMLDetailsElement).open)}>
          <summary>How these were made</summary>
          {p.findings && <><h4>Findings extracted from the paper</h4><ul>{p.findings.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
          {p.storyIdeas && <><h4>Story ideas</h4><ul>{p.storyIdeas.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
          {p.hooks && (
            <>
              <h4>Hooks and ratings</h4>
              <table className="hooks">
                <tbody>
                  {p.hooks.map((h) => {
                    const r = p.hookRatings?.find((x) => x.hookId === h.id);
                    const short = p.shortlistedHooks?.includes(h.id);
                    return (
                      <tr key={h.id} className={short ? 'short' : ''}>
                        <td>{h.text}{short && <span className="tag small">shortlisted</span>}</td>
                        <td className="bar-cell">{r ? <><div className="bar"><div style={{ width: `${r.score * 10}%` }} /></div><span title={r.reason}>{r.score}</span></> : <span className="muted">…</span>}</td>
                        <td className="muted small">{r?.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </details>
      )}
    </section>
  );
}
