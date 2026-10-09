import { useMemo, useState } from 'react';
import type { ChartSpec, Concept, ExampleRelation, ReshapeCandidate, Table } from '../../shared/types';
import { composeExampleRelation } from '../../shared/synth';
import { toVegaLite } from '../../shared/vega';
import { inferType } from '../../shared/concepts';
import { api } from '../api';
import { Code } from './Code';
import { DataTable } from './DataTable';
import { VegaChart } from './VegaChart';

/** Process 2 human modify: fill in example_relation. */
export function ExampleRelationEditor({
  relation,
  table,
  concepts,
  onChange,
}: {
  relation: ExampleRelation;
  table: Table;
  concepts: Concept[];
  onChange: (r: ExampleRelation) => void;
}) {
  const setCell = (i: number, j: number, v: string) =>
    onChange({ ...relation, rows: relation.rows.map((r, ri) => (ri === i ? r.map((c, ci) => (ci === j ? v : c)) : r)) });
  return (
    <div>
      <p className="muted">
        Fill in a few rows showing how the values relate in the chart you want. Values of existing concepts should be copied
        from the table. Empty cells are ignored.
      </p>
      <table className="relation">
        <thead>
          <tr>
            {relation.columns.map((c) => {
              const k = concepts.find((x) => x.name === c);
              return (
                <th key={c} className={`src-${k?.source ?? ''}`}>
                  {c}
                  {k?.source === 'custom' ? ' (new)' : ''}
                </th>
              );
            })}
            <th />
          </tr>
        </thead>
        <tbody>
          {relation.rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => {
                const col = relation.columns[j];
                const listId = table.columns.includes(col) ? `dl-${col}` : undefined;
                return (
                  <td key={j}>
                    <input value={cell} list={listId} onChange={(e) => setCell(i, j, e.target.value)} />
                  </td>
                );
              })}
              <td>
                <button className="link" onClick={() => onChange({ ...relation, rows: relation.rows.filter((_, k) => k !== i) })} title="Remove row">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {relation.columns
        .filter((c) => table.columns.includes(c))
        .map((c) => (
          <datalist key={c} id={`dl-${c}`}>
            {[...new Set(table.rows.slice(0, 200).map((r) => String(r[c] ?? '')))].slice(0, 100).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        ))}
      <button className="secondary" onClick={() => onChange({ ...relation, rows: [...relation.rows, relation.columns.map(() => '')] })}>
        + Row
      </button>
    </div>
  );
}

/** Process 2: candidate_tables* + candidate_charts*, with human select. */
export function ReshapeCandidates({
  candidates,
  spec,
  concepts,
  onSelect,
}: {
  candidates: ReshapeCandidate[];
  spec: ChartSpec;
  concepts: Concept[];
  onSelect: (c: ReshapeCandidate) => void;
}) {
  return (
    <div className="candidates">
      {candidates.map((c, i) => {
        // [tool_1 translate]: one vega_spec per candidate table, typed from its own data.
        const typed: Concept[] = c.table.columns.map((name) => ({
          name,
          source: 'original',
          type: concepts.find((k) => k.name === name && k.source !== 'custom')?.type ?? inferType(c.table.rows.map((r) => r[name] ?? null)),
        }));
        const vega = toVegaLite(spec, c.table.rows, typed, { width: 300, height: 200 });
        return (
          <div className="candidate" key={i}>
            <div className="candidate-head">
              <strong>Candidate {i + 1}</strong>
              <span className="muted small">
                {c.table.rows.length} rows × {c.table.columns.length} columns
              </span>
              <button onClick={() => onSelect(c)}>Use this result</button>
            </div>
            <VegaChart spec={vega} />
            <details>
              <summary>Reshaping program</summary>
              <Code code={c.code} />
            </details>
            <details>
              <summary>Table</summary>
              <DataTable columns={c.table.columns} rows={c.table.rows} limit={12} compact highlight={Object.values(spec.encodings) as string[]} />
            </details>
          </div>
        );
      })}
    </div>
  );
}

export function ReshapeDialog({
  table,
  spec,
  concepts,
  onAccept,
  onClose,
}: {
  table: Table;
  spec: ChartSpec;
  concepts: Concept[];
  onAccept: (c: ReshapeCandidate) => void;
  onClose: () => void;
}) {
  // [tool_1 compose]: example_relation_1
  const initial = useMemo(() => composeExampleRelation(table, spec, concepts), [table, spec, concepts]);
  const [relation, setRelation] = useState<ExampleRelation>(initial);
  const [candidates, setCandidates] = useState<ReshapeCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const synthesize = async () => {
    setBusy(true);
    setError(null);
    try {
      // [tool_2 execute] + [tool_1 execute]
      const res = await api.post<{ candidates: ReshapeCandidate[] }>('/api/reshape', { table, spec, relation });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) setError('No reshaping program reproduces these examples. Check the values against the table and try again.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Formulate by example</h2>
          <button className="link" onClick={onClose}>
            close
          </button>
        </div>
        <ExampleRelationEditor relation={relation} table={table} concepts={concepts} onChange={(r) => { setRelation(r); setCandidates(null); }} />
        <div className="row">
          <button onClick={synthesize} disabled={busy}>
            {busy ? 'Synthesizing…' : 'Synthesize reshaping'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {candidates && candidates.length > 0 && (
          <>
            <h3>Candidates — inspect and pick one</h3>
            <ReshapeCandidates candidates={candidates} spec={spec} concepts={concepts} onSelect={onAccept} />
          </>
        )}
      </div>
    </div>
  );
}
