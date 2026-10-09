import { useEffect, useRef, useState } from 'react';
import embed from 'vega-embed';
import type { TopLevelSpec } from 'vega-lite';
import type { Row } from '../types';

/** [tool_1 execute]: r4 + table rows -> r5 (rendered chart). */
export function Chart({ spec, rows, compact }: { spec: TopLevelSpec | null; rows: Row[]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current || !spec) return;
    setError(null);
    const full = {
      ...spec,
      data: { values: rows },
      ...(compact ? { width: 'container', height: 160 } : {}),
      autosize: { type: 'fit', contains: 'padding' },
    } as TopLevelSpec;
    const result = embed(ref.current, full, { actions: false, renderer: 'svg' });
    result.catch((e: Error) => setError(e.message));
    return () => {
      result.then((r) => r.finalize()).catch(() => {});
    };
  }, [spec, rows, compact]);
  if (!spec) return <div className="chart-empty">Drop fields onto the shelves to build a chart.</div>;
  return (
    <div className="chart-wrap">
      <div ref={ref} className="chart" />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
