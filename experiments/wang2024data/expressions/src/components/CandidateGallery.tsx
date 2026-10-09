import { useState } from 'react';
import type { VegaLiteSpec } from '../shared/translate';
import type { Table } from '../shared/types';
import { Code } from './Code';
import { DataTable } from './DataTable';
import { VegaChart } from './VegaChart';

export interface ChartCandidate {
  code: string;
  table: Table;
  vega: VegaLiteSpec;
}

/** candidate_tables_1* + candidate_charts_1* -> [human select]. */
export function CandidateGallery({ candidates, onSelect, onBack }: { candidates: ChartCandidate[]; onSelect: (i: number) => void; onBack: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="panel gallery">
      <div className="row-actions">
        <h2>{candidates.length} candidate{candidates.length === 1 ? '' : 's'} — pick the one you meant</h2>
        <span className="spacer" />
        <button onClick={onBack}>Back to example</button>
      </div>
      <div className="candidates">
        {candidates.map((c, i) => (
          <div key={i} className="candidate">
            <VegaChart spec={c.vega} />
            <Code code={c.code} />
            <div className="row-actions">
              <button className="link" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'hide' : 'show'} table ({c.table.rows.length} rows)</button>
              <span className="spacer" />
              <button className="primary" onClick={() => onSelect(i)}>Use this</button>
            </div>
            {open === i && <DataTable table={c.table} maxRows={12} />}
          </div>
        ))}
      </div>
    </section>
  );
}
