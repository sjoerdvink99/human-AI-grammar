/** Editor for language* collections (data facts). */
export function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="list-editor">
      {items.map((it, i) => (
        <div key={i} className="list-row">
          <span className="idx">{i}</span>
          <textarea rows={2} value={it} onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))} />
          <button className="icon" title="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <button className="ghost small" onClick={() => onChange([...items, ''])}>+ {placeholder}</button>
    </div>
  );
}
