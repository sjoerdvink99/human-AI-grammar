import { useEffect, useState, type ReactNode } from 'react';

/** A named representation from the design, shown with its identifier so it can be traced. */
export function Rep({ id, role, medium, children, active }: { id: string; role: string; medium: string; children?: ReactNode; active?: boolean }) {
  return (
    <div className={`rep ${active ? 'rep-active' : ''}`}>
      <div className="rep-head">
        <code>{id}</code>
        <span className="rep-type">{role} · {medium}</span>
      </div>
      {children && <div className="rep-body">{children}</div>}
    </div>
  );
}

/** A transformation arrow in the pipeline column. */
export function Step({ actor, op, generative, done, running }: { actor: string; op: string; generative?: boolean; done?: boolean; running?: boolean }) {
  const kind = actor.startsWith('human') ? 'human' : actor.startsWith('model') ? 'model' : 'tool';
  return (
    <div className={`step step-${kind} ${done ? 'step-done' : ''} ${running ? 'step-running' : ''}`}>
      ↓ [{actor} {op}]{generative ? '~' : ''}
    </div>
  );
}

/** Loading state for generative steps, with elapsed time (CLI-generated images take a while). */
export function Generating({ label }: { label: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const h = setInterval(() => setT(Math.round((Date.now() - start) / 1000)), 500);
    return () => clearInterval(h);
  }, []);
  return (
    <div className="generating">
      <div className="spinner" /> {label} <span className="muted">{t}s</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error">
      {error} {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function download(filename: string, content: string, type = 'image/svg+xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
