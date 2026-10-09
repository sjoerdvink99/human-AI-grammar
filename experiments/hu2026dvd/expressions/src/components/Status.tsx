export function Status({ busy, progress, error, onDismiss }: { busy: string | null; progress: number | null; error: string | null; onDismiss?: () => void }) {
  if (!busy && !error) return null;
  return (
    <div className={`status ${error ? 'status-error' : ''}`}>
      {busy && (
        <>
          <span className="spinner" /> {busy}
          {progress != null && (
            <span className="progress">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
        </>
      )}
      {error && (
        <>
          <span>⚠ {error}</span>
          {onDismiss && <button className="link" onClick={onDismiss}>dismiss</button>}
        </>
      )}
    </div>
  );
}
