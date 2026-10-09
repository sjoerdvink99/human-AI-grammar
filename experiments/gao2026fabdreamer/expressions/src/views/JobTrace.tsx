import { useEffect, useState } from 'react';
import type { Runner } from '../api.ts';

/** Shows the grammar steps of the running/last job (handles the `~` generative steps' loading state). */
export function JobTrace({ jobs }: { jobs: Runner }) {
  const { job, error } = jobs;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [job?.status]);
  return (
    <div>
      <h3>Process trace</h3>
      {!job && <p className="muted small">Model and tool steps appear here as they run.</p>}
      {job && (
        <>
          <div className={`jobstatus ${job.status}`}>
            {job.status === 'running' ? <span className="spinner" /> : null} {job.kind.toUpperCase()} · {job.status} · {(((job.finishedAt ?? now) - job.startedAt) / 1000).toFixed(0)}s
          </div>
          <ol className="steps">
            {job.steps.map((s, i) => (
              <li key={i} className={s.status}>
                <div className="stepname">
                  {s.status === 'running' ? <span className="spinner" /> : s.status === 'error' ? '✕' : '✓'} {s.step}
                </div>
                {s.detail && <div className="stepdetail">{s.detail}</div>}
              </li>
            ))}
          </ol>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
