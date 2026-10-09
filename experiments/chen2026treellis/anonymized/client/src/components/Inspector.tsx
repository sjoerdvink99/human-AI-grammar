// Process 3: with r7 selected, the human specifies r9 {attr, value}; the tool modify runs in App.
import { useState } from 'react';
import { allowedAttrs, fmt, type ParamRecord, type SceneNode } from '../../../shared/dsl';
import { toRawValue } from '../../../shared/edit';

export function Inspector({ node, params, disabled, onSpecify, onSelectParent, onTargetForAI }: {
  node: SceneNode;
  params: ParamRecord[];
  disabled: boolean;
  onSpecify: (attr: string, raw: string | null) => string | null;
  onSelectParent: () => void;
  onTargetForAI: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState('');
  const present = Object.keys(node.attrs);
  const missing = allowedAttrs(node.kind).filter((a) => !present.includes(a));

  const apply = (attr: string, input: string | null) => {
    const raw = input === null ? null : toRawValue(input, attr, params);
    if (raw !== null && raw === node.attrs[attr]?.raw) return;
    const err = onSpecify(attr, raw);
    setErrors((e) => ({ ...e, [attr]: err ?? '' }));
  };

  return (
    <section className="inspector">
      <div className="inspector-head">
        <h2>{node.name} <span className="muted kind">{node.kind}</span></h2>
        <div className="row">
          {node.id.includes('/') && <button className="ghost small" onClick={onSelectParent}>↑ Parent</button>}
          <button className="accent small" disabled={disabled} onClick={onTargetForAI} title="Describe a change to just this element">
            ✦ Edit with AI
          </button>
        </div>
      </div>
      <p className="muted small">lines {node.startLine}–{node.endLine}. Values may use parameters, e.g. <code>{params.find((p) => p.type === 'number')?.name ?? 'w'}/2</code>.</p>
      <table className="attrs">
        <tbody>
          {present.map((attr) => {
            const a = node.attrs[attr];
            const shownRaw = a.raw.startsWith('"') && !a.raw.includes('{') ? String(a.value) : a.raw;
            const isColor = (attr === 'fill' || attr === 'stroke') && typeof a.value === 'string' && /^#[0-9a-f]{6}$/i.test(a.value);
            return (
              <tr key={attr}>
                <th>{attr}</th>
                <td>
                  <div className="row">
                    {isColor && (
                      <input type="color" disabled={disabled} value={String(a.value)} onChange={(e) => apply(attr, e.target.value)} />
                    )}
                    <input
                      key={a.raw}
                      className="attr-input"
                      defaultValue={shownRaw}
                      disabled={disabled}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      onBlur={(e) => apply(attr, e.target.value)}
                    />
                    <button className="ghost small" title="Remove attribute" disabled={disabled} onClick={() => apply(attr, null)}>×</button>
                  </div>
                  {(a.raw.startsWith('"') ? a.raw.includes('{') : /[A-Za-z_(]/.test(a.raw))
                    ? <div className="muted small">= {typeof a.value === 'number' ? fmt(a.value) : a.value}</div>
                    : null}
                  {errors[attr] && <pre className="error small">{errors[attr]}</pre>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {missing.length > 0 && (
        <div className="row add-attr">
          <select value={adding} disabled={disabled} onChange={(e) => setAdding(e.target.value)}>
            <option value="">+ add attribute…</option>
            {missing.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {adding && (
            <input
              autoFocus
              placeholder="value, then Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  apply(adding, e.currentTarget.value);
                  setAdding('');
                }
              }}
            />
          )}
        </div>
      )}
      {errors[adding] && <pre className="error small">{errors[adding]}</pre>}
    </section>
  );
}
