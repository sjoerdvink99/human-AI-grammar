import type { Table } from '../shared/types';

export function DataTable({ table, maxRows = 100, highlight = [] }: { table: Table; maxRows?: number; highlight?: string[] }) {
  const rows = table.rows.slice(0, maxRows);
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c} className={highlight.includes(c) ? 'hl' : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td key={c} className={highlight.includes(c) ? 'hl' : undefined}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > maxRows && <div className="muted small">Showing {maxRows} of {table.rows.length} rows</div>}
    </div>
  );
}
