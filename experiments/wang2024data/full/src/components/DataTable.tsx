import type { Concept, Row, Value } from '../../shared/types';

const fmt = (v: Value) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

/** Tabular view used for table, candidate_tables, preview_tables. */
export function DataTable({
  columns,
  rows,
  concepts = [],
  highlight = [],
  limit = 200,
  compact = false,
}: {
  columns: string[];
  rows: Row[];
  concepts?: Concept[];
  highlight?: string[];
  limit?: number;
  compact?: boolean;
}) {
  const shown = rows.slice(0, limit);
  return (
    <div className={`table-wrap ${compact ? 'compact' : ''}`}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => {
              const concept = concepts.find((k) => k.name === c);
              return (
                <th key={c} className={`${highlight.includes(c) ? 'hl' : ''} src-${concept?.source ?? ''}`}>
                  {c}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className={`${highlight.includes(c) ? 'hl' : ''} ${typeof r[c] === 'number' ? 'num' : ''}`}>
                  {fmt(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && <div className="muted small">showing {limit} of {rows.length} rows</div>}
    </div>
  );
}
