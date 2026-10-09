import { useMemo, useState } from "react";
import type { StepProps } from "../App.tsx";
import { Panel, SvgView } from "../components.tsx";
import { deriveCharts } from "../derive.ts";
import { finalizeChart } from "../tools/finalize.ts";
import { exportChart } from "../tools/export.ts";
import type { ExportFormat } from "../types.ts";

const FORMATS: { f: ExportFormat; label: string }[] = [
  { f: "svg", label: "SVG (vector)" },
  { f: "png", label: "PNG (3×)" },
  { f: "jpeg", label: "JPEG (3×)" },
];

export default function ExportStep({ state, update }: StepProps) {
  const [error, setError] = useState("");
  const r27 = useMemo(() => {
    const { r23 } = deriveCharts(state);
    try {
      return finalizeChart(r23, { ...state.r26, chartIndex: Math.min(state.r26.chartIndex, r23.length - 1) });
    } catch {
      return "";
    }
  }, [state.r1, state.r13, state.r14, state.r19, state.r21, state.r26]);

  // Process 8 · tool_3 translate: r27 + r28 -> r29
  const download = async () => {
    setError("");
    try {
      const { blob, filename } = await exportChart(r27, state.r28);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="step">
      <h2>7 · Export</h2>
      <div className="grid-side">
        <Panel title="Final chart" tag="r27 · visual">
          {r27 ? <SvgView svg={r27} className="final" /> : <p className="muted">Nothing to export yet.</p>}
        </Panel>
        <Panel title="Format" tag="r28 · instruction categorical">
          <div className="seg-buttons">
            {FORMATS.map(({ f, label }) => (
              <button key={f} className={state.r28 === f ? "active" : ""} onClick={() => update((s) => ({ ...s, r28: f }))}>
                {label}
              </button>
            ))}
          </div>
          <button className="primary" disabled={!r27} onClick={download}>
            Download {state.r28.toUpperCase()}
          </button>
          {error && <div className="error">{error}</div>}
        </Panel>
      </div>
    </div>
  );
}
