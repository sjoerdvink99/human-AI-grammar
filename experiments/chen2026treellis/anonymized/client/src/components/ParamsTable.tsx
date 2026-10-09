// Process 4: r6 (artifact record) as a table. Clicking a row is human select → r10;
// the slider / input on that row is human specify → r11; App runs tool modify.
import { useState } from 'react';
import { fmt, type ParamRecord } from '../../../shared/dsl';

export function ParamsTable({ params, selected, disabled, onSelect, onSpecify }: {
  params: ParamRecord[];
  selected: string | null;
  disabled: boolean;
  onSelect: (name: string | null) => void;
  onSpecify: (param: ParamRecord, raw: string) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!params.length) return <p className="muted">No parameters. Ask the model to expose some.</p>;
  const apply = (p: ParamRecord, raw: string) => setError(onSpecify(p, raw));

  return (
    <>
      <table className="params">
        <tbody>
          {params.map((p) => {
            const isSel = p.name === selected;
            return (
              <tr key={p.name} className={isSel ? 'selected' : ''} onClick={() => !isSel && onSelect(p.name)}>
                <th>{p.name}</th>
                <td>
                  {!isSel ? (
                    <span className="param-value">
                      {p.type === 'color' && <span className="swatch" style={{ background: String(p.value) }} />}
                      {typeof p.value === 'number' ? fmt(p.value) : p.value}
                    </span>
                  ) : (
                    <ParamEditor param={p} disabled={disabled} onApply={(raw) => apply(p, raw)} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <pre className="error small">{error}</pre>}
    </>
  );
}

function ParamEditor({ param, disabled, onApply }: { param: ParamRecord; disabled: boolean; onApply: (raw: string) => void }) {
  if (param.type === 'number') {
    const v = param.value as number;
    const min = param.min ?? Math.min(0, v);
    const max = param.max ?? Math.max(v * 2, 10);
    const step = max - min <= 2 ? 0.01 : max - min <= 20 ? 0.1 : 1;
    return (
      <div className="row">
        <input type="range" min={min} max={max} step={step} value={v} disabled={disabled}
          onChange={(e) => onApply(fmt(Number(e.target.value)))} />
        <input key={param.raw} className="num" defaultValue={param.raw} disabled={disabled}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => e.target.value !== param.raw && onApply(e.target.value)} />
      </div>
    );
  }
  if (param.type === 'color') {
    return (
      <div className="row">
        <input type="color" value={String(param.value)} disabled={disabled} onChange={(e) => onApply(`"${e.target.value}"`)} />
        <span className="muted">{String(param.value)}</span>
      </div>
    );
  }
  return (
    <input key={param.raw} defaultValue={String(param.value)} disabled={disabled}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onBlur={(e) => e.target.value !== param.value && onApply(JSON.stringify(e.target.value))} />
  );
}
