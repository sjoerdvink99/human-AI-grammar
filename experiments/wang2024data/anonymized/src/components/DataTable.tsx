import type { FieldMeta, Table } from '../types';

export function DataTable({ table, fields, limit = 200, highlight }: { table: Table; fields?: FieldMeta[]; limit?: number; highlight?: string }) {
  const src = new Map((fields ?? []).map((f) => [f.name, f.source]));
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c} className={`src-${src.get(c) ?? 'none'} ${c === highlight ? 'hl' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, limit).map((r, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td key={c} className={c === highlight ? 'hl' : ''}>
                  {r[c] === null || r[c] === undefined ? <span className="null">null</span> : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > limit && <div className="muted">… {table.rows.length - limit} more rows</div>}
    </div>
  );
}
