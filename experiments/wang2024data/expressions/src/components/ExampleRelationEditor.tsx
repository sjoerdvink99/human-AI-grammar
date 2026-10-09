import { normalizeCell } from '../shared/concepts';
import type { Concept, Table } from '../shared/types';

interface Props {
  example: Table;
  concepts: Concept[];
  onChange: (t: Table) => void;
  onSubmit: () => void;
  onCancel: () => void;
  message?: string;
}

/** [human modify] example_relation_1 -> example_relation_2: an editable grid. */
export function ExampleRelationEditor({ example, concepts, onChange, onSubmit, onCancel, message }: Props) {
  const isCustom = (c: string) => concepts.find((k) => k.name === c)?.source === 'custom';
  const setCell = (i: number, col: string, v: string) => {
    const rows = example.rows.map((r, j) => (j === i ? { ...r, [col]: normalizeCell(v) } : r));
    onChange({ ...example, rows });
  };
  return (
    <section className="panel example">
      <h2>Show an example of the data this chart needs</h2>
      <p className="muted small">
        Each row is one data point of the chart. Fill in values for the new concepts
        (<b>highlighted</b>) using values that appear in the table, e.g. a column name or a cell value.
      </p>
      <table className="example-grid">
        <thead>
          <tr>
            {example.columns.map((c) => <th key={c} className={isCustom(c) ? 'hl' : undefined}>{c}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {example.rows.map((r, i) => (
            <tr key={i}>
              {example.columns.map((c) => (
                <td key={c} className={isCustom(c) ? 'hl' : undefined}>
                  <input value={r[c] === null ? '' : String(r[c])} onChange={(e) => setCell(i, c, e.target.value)} />
                </td>
              ))}
              <td>
                <button className="link" disabled={example.rows.length <= 1} onClick={() => onChange({ ...example, rows: example.rows.filter((_, j) => j !== i) })}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-actions">
        <button onClick={() => onChange({ ...example, rows: [...example.rows, Object.fromEntries(example.columns.map((c) => [c, null]))] })}>+ row</button>
        <span className="spacer" />
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={onSubmit}>Find matching tables</button>
      </div>
      {message && <div className="error">{message}</div>}
    </section>
  );
}
