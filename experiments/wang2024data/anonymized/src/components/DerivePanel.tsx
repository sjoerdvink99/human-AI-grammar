import { useState } from 'react';
import type { CodeCandidate, DeriveRequest, EvaluatedCandidate, FieldMeta, Table } from '../types';
import { composePrompts } from '../tools/composePrompts';
import { Code } from './Code';
import { DataTable } from './DataTable';

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

type Phase = 'form' | 'generating' | 'evaluating' | 'review' | 'applying' | 'done';

/**
 * Processes 3 and 4: derive a concept with the model.
 * [human specify|modify] r11 -> [tool_1 compose] r12* -> [model generate]~ r13* ->
 * [tool_1 evaluate] r14* + r15* -> [human select] r16 -> [tool_1 execute] r1' + r2'.
 */
export function DerivePanel(props: {
  table: Table;
  fields: FieldMeta[];
  initial?: DeriveRequest;
  onApply: (table: Table, request: DeriveRequest, code: string) => void;
  onClose: () => void;
}) {
  const editing = !!props.initial;
  const [req, setReq] = useState<DeriveRequest>(props.initial ?? { name: '', description: '', sourceFields: [] });
  const [phase, setPhase] = useState<Phase>('form');
  const [prompts, setPrompts] = useState<string[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [candidates, setCandidates] = useState<EvaluatedCandidate[]>([]);
  const [rejected, setRejected] = useState<{ id: string; error: string }[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const otherFields = props.fields.filter((f) => f.name !== props.initial?.name);
  const nameClash = !editing && props.fields.some((f) => f.name === req.name.trim());
  const valid = req.name.trim() !== '' && req.description.trim() !== '' && !nameClash;
  // Exclude the column being redefined so the model cannot just copy the old values.
  const inputTable: Table = editing
    ? {
        ...props.table,
        columns: props.table.columns.filter((c) => c !== props.initial!.name),
        rows: props.table.rows.map(({ [props.initial!.name]: _old, ...rest }) => rest),
      }
    : props.table;

  const generate = async () => {
    const request = { ...req, name: req.name.trim() };
    setError(null);
    setChosen(null);
    setCandidates([]);
    setRejected([]);
    // [tool_1 compose]: r1 + r2* + r11 -> r12*
    const ps = composePrompts(inputTable, otherFields, request);
    setPrompts(ps);
    try {
      // [model generate]~: r12* -> r13*
      setPhase('generating');
      const gen = await post<{ candidates: CodeCandidate[]; failures: { promptIndex: number; error: string }[] }>('/api/generate', { prompts: ps });
      // [tool_1 evaluate]: r13* -> r14* + r15*
      setPhase('evaluating');
      const ev = await post<{ evaluated: EvaluatedCandidate[]; rejected: { id: string; error: string }[] }>('/api/evaluate', {
        candidates: gen.candidates,
        table: inputTable,
        name: request.name,
        sourceFields: request.sourceFields,
      });
      setCandidates(ev.evaluated);
      setRejected([...gen.failures.map((f) => ({ id: `prompt ${f.promptIndex + 1}`, error: f.error })), ...ev.rejected]);
      if (ev.evaluated.length === 1) setChosen(ev.evaluated[0].id);
      setPhase('review');
    } catch (e) {
      setError((e as Error).message);
      setPhase('form');
    }
  };

  // [tool_1 execute]: r1 + r16 -> r1' + r2'
  const apply = async () => {
    const c = candidates.find((x) => x.id === chosen);
    if (!c) return;
    setPhase('applying');
    try {
      const request = { ...req, name: req.name.trim() };
      const { table } = await post<{ table: Table }>('/api/execute', { code: c.code, table: props.table, name: request.name });
      props.onApply(table, request, c.code);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('review');
    }
  };

  const busy = phase === 'generating' || phase === 'evaluating' || phase === 'applying';

  return (
    <div className="side-panel">
      <div className="panel-head">
        <h2>{editing ? `Edit derived field “${props.initial!.name}”` : 'Derive a new field'}</h2>
        <button className="x" onClick={props.onClose}>
          ×
        </button>
      </div>
      <label>
        Name
        <input value={req.name} disabled={editing || busy} onChange={(e) => setReq({ ...req, name: e.target.value })} placeholder="e.g. Average" />
      </label>
      {nameClash && <div className="error">A field with this name already exists.</div>}
      <label>
        Description
        <textarea
          rows={3}
          value={req.description}
          disabled={busy}
          onChange={(e) => setReq({ ...req, description: e.target.value })}
          placeholder="e.g. the mean of Math and Reading, rounded to one decimal"
        />
      </label>
      <div className="label">Derived from</div>
      <div className="checks">
        {otherFields.map((f) => (
          <label key={f.name} className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={req.sourceFields.includes(f.name)}
              onChange={(e) =>
                setReq({
                  ...req,
                  sourceFields: e.target.checked ? [...req.sourceFields, f.name] : req.sourceFields.filter((s) => s !== f.name),
                })
              }
            />
            {f.name}
          </label>
        ))}
      </div>
      <p className="hint">No fields ticked = all fields are passed to the model.</p>
      <button className="primary wide" disabled={!valid || busy} onClick={generate}>
        {phase === 'review' || phase === 'done' ? 'Regenerate' : 'Generate code'}
      </button>
      {phase === 'generating' && <div className="loading">Model is writing {prompts.length} candidate functions…</div>}
      {phase === 'evaluating' && <div className="loading">Running candidates on the data…</div>}
      {error && <div className="error">{error}</div>}

      {prompts.length > 0 && (
        <div className="section">
          <button className="link" onClick={() => setShowPrompts(!showPrompts)}>
            {showPrompts ? '▾' : '▸'} Prompts sent to the model ({prompts.length})
          </button>
          {showPrompts && prompts.map((p, i) => <Code key={i} code={p} maxHeight={220} />)}
        </div>
      )}

      {(phase === 'review' || phase === 'applying' || phase === 'done') && (
        <div className="section">
          <h3>Candidates ({candidates.length})</h3>
          {candidates.length === 0 && <div className="error">No candidate ran successfully. Refine the description and regenerate.</div>}
          {candidates.map((c) => (
            <div key={c.id} className={`card selectable ${chosen === c.id ? 'chosen' : ''}`} onClick={() => phase !== 'done' && setChosen(c.id)}>
              <div className="card-head">
                <label>
                  <input type="radio" checked={chosen === c.id} readOnly /> <b>{c.id}</b>
                </label>
                <span className="muted">
                  {c.outputType}
                  {c.nullCount > 0 ? ` · ${c.nullCount} nulls` : ''}
                </span>
              </div>
              <DataTable table={c.preview} highlight={req.name.trim()} />
              <Code code={c.code} maxHeight={200} />
            </div>
          ))}
          {rejected.length > 0 && (
            <details className="muted">
              <summary>{rejected.length} rejected</summary>
              <ul>
                {rejected.map((r) => (
                  <li key={r.id}>
                    {r.id}: {r.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {phase !== 'done' && (
            <button className="primary wide" disabled={!chosen || phase === 'applying'} onClick={apply}>
              {editing ? 'Replace column' : 'Add column to table'}
            </button>
          )}
          {phase === 'done' && <div className="ok">“{req.name}” is in the table. Drag it onto a shelf to chart it, or edit it later with ✎.</div>}
        </div>
      )}
    </div>
  );
}
