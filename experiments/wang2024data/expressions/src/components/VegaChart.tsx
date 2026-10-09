import { useEffect, useRef, useState } from 'react';
import embed from 'vega-embed';
import type { VegaLiteSpec } from '../shared/translate';

/** [tool_1 execute]: vega_spec -> chart (rendered with vega-embed). */
export function VegaChart({ spec }: { spec: VegaLiteSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    let finalize: (() => void) | undefined;
    let cancelled = false;
    setError(null);
    embed(ref.current, spec as never, { actions: { export: true, source: false, compiled: false, editor: false }, renderer: 'svg' })
      .then((r) => {
        if (cancelled) r.finalize();
        else finalize = () => r.finalize();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [spec]);
  return (
    <div className="vega-chart">
      <div ref={ref} />
      {error && <div className="error">Chart error: {error}</div>}
    </div>
  );
}
