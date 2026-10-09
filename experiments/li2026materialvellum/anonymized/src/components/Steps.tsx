// Pipeline panel: shows each transformation of the current process and its status.
export type StepStatus = "todo" | "ready" | "running" | "done" | "error";
export interface StepInfo { id: string; actor: string; op: string; label: string; status: StepStatus; generative?: boolean }

export function Steps({ steps }: { steps: StepInfo[] }) {
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.id} className={`step ${s.status}`}>
          <span className="dot" />
          <span className="actor">[{s.actor} {s.op}]{s.generative ? "~" : ""}</span>
          <span className="lbl">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function Spinner({ text }: { text: string }) {
  return <div className="spinner"><span className="spin" /> {text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error">
      {error} {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}
