import { useMemo, useState } from 'react';
import type { Encoding, ExampleTable, FieldMeta, Program, Table } from '../types';
import { composeExampleTable } from '../tools/composeExample';
import { synthesizePrograms } from '../tools/synthesize';
import { programToCode, runProgram } from '../tools/reshape';
import { translateToSpec } from '../tools/translate';
import { extractFields } from '../tools/extract';
import { Chart } from './Chart';
import { Code } from './Code';
import { DataTable } from './DataTable';

/**
 * Process 2: formulate new concepts by example.
 * compose r7 -> [human modify] r7 -> [tool_2 execute] r8* -> [tool_1 execute] r9* ->
 * [tool_1 translate] r4_2 -> [tool_1 execute] r10* -> [human select] -> r1_2 + r5_2.
 */
export function FormulatePanel(props: {
  table: Table;
  fields: FieldMeta[];
  encoding: Encoding;
  onSelect: (table: Table) => void;
  onClose: () => void;
}) {
  // [tool_1 compose]: r1 + r6* + r3_2 -> r7_1
  const [example, setExample] = useState<ExampleTable>(() => composeExampleTable(props.table, props.encoding));
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [showTable, setShowTable] = useState<number | null>(null);
  const newCols = example.columns.filter((c) => !props.table.columns.includes(c));

  // [human modify]: r7_1 -> r7_2
  const setCell = (i: number, c: string, v: string) => {
    setExample({ ...example, rows: example.rows.map((r, j) => (j === i ? { ...r, [c]: v } : r)) });
    setPrograms(null);
  };
  const addRow = () => setExample({ ...example, rows: [...example.rows, Object.fromEntries(example.columns.map((c) => [c, '']))] });
  const removeRow = (i: number) => setExample({ ...example, rows: example.rows.filter((_, j) => j !== i) });

  // r9* (tool_1 execute), r4_2 (tool_1 translate), rendered as r10* below
  const candidates = useMemo(() => {
    if (!programs) return [];
    return programs.map((p) => {
      const table = runProgram(props.table, p);
      const types = new Map(extractFields(table).map((f) => [f.name, f.type]));
      const spec = translateToSpec(props.encoding, (n) => types.get(n));
      return { program: p, table, spec };
    });
  }, [programs, props.table, props.encoding]);

  return (
    <div className="side-panel">
      <div className="panel-head">
        <h2>Formulate by example</h2>
        <button className="x" onClick={props.onClose}>
          ×
        </button>
      </div>
      <p className="hint">
        Fill in a few example rows of the table your chart needs. New concepts: <b>{newCols.join(', ') || '—'}</b>. Leave cells blank if you
        don't know them.
      </p>
      <div className="example-table">
        <table>
          <thead>
            <tr>
              {example.columns.map((c) => (
                <th key={c} className={newCols.includes(c) ? 'src-concept' : 'src-original'}>
                  {c}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {example.rows.map((r, i) => (
              <tr key={i}>
                {example.columns.map((c) => (
                  <td key={c}>
                    <input value={r[c] ?? ''} onChange={(e) => setCell(i, c, e.target.value)} />
                  </td>
                ))}
                <td>
                  <button className="x" onClick={() => removeRow(i)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addRow}>+ row</button>
      </div>
      <button className="primary wide" onClick={() => setPrograms(synthesizePrograms(props.table, props.fields, example))}>
        Synthesize transformations
      </button>
      {programs && programs.length === 0 && (
        <div className="error">
          No fold or pivot program reproduces these examples. Check that example values exist in the data (e.g. a column name like "Q1" as a value,
          or a category value as a new column name).
        </div>
      )}
      <div className="gallery">
        {candidates.map((c, i) => (
          <div key={i} className="card">
            <div className="card-head">
              <b>Candidate {i + 1}</b>
              <span className="muted">
                {c.table.rows.length} rows × {c.table.columns.length} cols
              </span>
            </div>
            <Chart spec={c.spec} rows={c.table.rows} compact />
            <Code code={programToCode(c.program)} />
            <div className="row">
              <button onClick={() => setShowTable(showTable === i ? null : i)}>{showTable === i ? 'Hide' : 'Show'} table</button>
              <button className="primary" onClick={() => props.onSelect(c.table)}>
                Use this
              </button>
            </div>
            {showTable === i && <DataTable table={c.table} limit={15} />}
          </div>
        ))}
      </div>
    </div>
  );
}
