// Process 1 entry: the human writes r1 (instruction language).
const EXAMPLES = [
  'A small house with a red roof, a door, two windows and a tree next to it under a sunny sky',
  'A friendly robot face with antenna and round eyes',
  'A bar chart of four fruits with labels',
  'A sailboat on waves at sunset',
];

export function StartScreen(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: { label: string } | null;
  error: string | null;
}) {
  const { value, onChange, onSubmit, onCancel, busy, error } = props;
  return (
    <div className="start">
      <h1>System X</h1>
      <p className="muted">Describe a picture. A model writes it as a small drawing program you can then edit by clicking, by parameters, or by asking.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(); }}>
        <textarea
          autoFocus
          rows={4}
          value={value}
          disabled={!!busy}
          placeholder="What should I draw?"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && value.trim()) onSubmit(); }}
        />
        <div className="row">
          {busy ? (
            <>
              <span className="spinner" /> <span>{busy.label} (this can take up to a minute)</span>
              <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
            </>
          ) : (
            <button type="submit" disabled={!value.trim()}>Draw it</button>
          )}
        </div>
      </form>
      {error && <pre className="error">{error}</pre>}
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" disabled={!!busy} onClick={() => onChange(ex)}>{ex}</button>
        ))}
      </div>
    </div>
  );
}
