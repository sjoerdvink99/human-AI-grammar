export function Busy({ label }: { label: string }) {
  return (
    <div className="busy">
      <span className="spinner" /> {label}… <span className="small">(model calls take 10–90 s)</span>
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
