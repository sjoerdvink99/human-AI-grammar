import { useEffect, useRef, useState } from 'react';
import embed from 'vega-embed';

/** [tool_1 execute]: vega_spec -> chart. */
export function VegaChart({ spec }: { spec: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    let view: { finalize: () => void } | undefined;
    let cancelled = false;
    setError(null);
    embed(ref.current, spec as never, { actions: { export: true, source: false, compiled: false, editor: false }, renderer: 'svg' })
      .then((r) => {
        if (cancelled) r.finalize();
        else view = r;
      })
      .catch((e) => setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);
  return (
    <div>
      <div ref={ref} />
      {error && <div className="error">Chart error: {error}</div>}
    </div>
  );
}
