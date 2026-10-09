import { useEffect, useMemo } from "react";
import type { StepProps } from "../App.tsx";
import { Panel, SvgView } from "../components.tsx";
import { defaultSpec, deriveCharts } from "../derive.ts";
import { CANVAS } from "../tools/sanitize.ts";
import type { ChartSpec, LayoutKind } from "../types.ts";

const LAYOUTS: { kind: LayoutKind; label: string }[] = [
  { kind: "in-place", label: "In place — marks sit where the objects were" },
  { kind: "isotype", label: "Isotype rows — one icon per unit" },
  { kind: "sized-row", label: "Sized row — icon area ∝ value" },
  { kind: "bars", label: "Icon columns — stacked icons" },
];

export default function ChartStep({ state, update, go }: StepProps) {
  useEffect(() => {
    if (!state.r21) {
      const spec = defaultSpec(state);
      if (spec) update((s) => ({ ...s, r21: spec }));
    }
  }, [state.r21, state.crops, state.r19]);

  const { r20, r22, r23 } = useMemo(() => deriveCharts(state), [state.r1, state.r13, state.r14, state.r19, state.r21]);
  const spec = state.r21;
  // Process 6 · human modify: editing r21 loops back and recomposes r22/r23
  const set = (patch: Partial<ChartSpec>) => update((s) => ({ ...s, r21: { ...s.r21!, ...patch } }));
  const numericFields = state.r2?.columns.filter((c) => c.type === "number").map((c) => c.name) ?? [];
  const sets = state.crops.filter((c) => state.r19.some((v) => v.segmentId === c.segmentId && v.svg));
  const missing = spec ? state.r19.filter((v) => v.segmentId === spec.segmentId && !v.svg).map((v) => v.category) : [];

  if (!spec) return <div className="step"><p className="muted">Generate element variants first.</p></div>;

  return (
    <div className="step">
      <h2>5 · Chart</h2>
      <div className="grid-side">
        <div>
          <Panel title="Composed charts" tag="r23 · visual*">
            {missing.length > 0 && <p className="muted small">No variant yet for: {missing.join(", ")} (left out).</p>}
            {r23.length === 0 && <p className="muted">Choose at least one layout.</p>}
            <div className="charts">
              {r23.map((c) => (
                <figure key={c.layout}>
                  <SvgView svg={c.svg} />
                  <figcaption>{LAYOUTS.find((l) => l.kind === c.layout)?.label}</figcaption>
                </figure>
              ))}
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="Chart specification" tag="r21 · instruction record">
            <div className="form">
              <label>
                Element set
                <select
                  value={spec.segmentId}
                  onChange={(e) => {
                    const c = sets.find((x) => x.segmentId === e.target.value)!;
                    set({ segmentId: c.segmentId, categoryField: c.field });
                  }}
                >
                  {sets.map((c) => (
                    <option key={c.segmentId} value={c.segmentId}>
                      {c.name} ({c.field})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Value
                <select value={spec.valueField} onChange={(e) => set({ valueField: e.target.value, aggregate: e.target.value ? spec.aggregate === "count" ? "sum" : spec.aggregate : "count" })}>
                  <option value="">(row count)</option>
                  {numericFields.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Aggregate
                <select value={spec.aggregate} disabled={!spec.valueField} onChange={(e) => set({ aggregate: e.target.value as ChartSpec["aggregate"] })}>
                  <option value="sum">sum</option>
                  <option value="mean">mean</option>
                  <option value="count">count</option>
                </select>
              </label>
              <label>
                Sort
                <select value={spec.sort} onChange={(e) => set({ sort: e.target.value as ChartSpec["sort"] })}>
                  <option value="none">data order</option>
                  <option value="desc">largest first</option>
                  <option value="asc">smallest first</option>
                </select>
              </label>
              <label>
                Value per icon (0 = auto)
                <input type="number" min={0} value={spec.unitValue} onChange={(e) => set({ unitValue: Math.max(0, Number(e.target.value)) })} />
              </label>
              <label>
                Icon size {spec.minSize}–{spec.maxSize}px
                <div className="row gap">
                  <input type="range" min={8} max={80} value={spec.minSize} onChange={(e) => set({ minSize: Math.min(Number(e.target.value), spec.maxSize) })} />
                  <input type="range" min={30} max={160} value={spec.maxSize} onChange={(e) => set({ maxSize: Math.max(Number(e.target.value), spec.minSize) })} />
                </div>
              </label>
              <fieldset>
                <legend>Layouts</legend>
                {LAYOUTS.map((l) => (
                  <label key={l.kind} className="check">
                    <input
                      type="checkbox"
                      checked={spec.layouts.includes(l.kind)}
                      onChange={(e) => set({ layouts: e.target.checked ? LAYOUTS.map((x) => x.kind).filter((k) => k === l.kind || spec.layouts.includes(k)) : spec.layouts.filter((k) => k !== l.kind) })}
                    />
                    {l.label}
                  </label>
                ))}
              </fieldset>
            </div>
          </Panel>
          <Panel title="Anchors" tag="r20 · spatial*">
            <svg viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} className="anchors">
              <rect width={CANVAS.width} height={CANVAS.height} fill="#f4f1ea" />
              {r20.map((a, i) => (
                <g key={a.segmentId}>
                  <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="#1c7ed622" stroke="#1c7ed6" />
                  <text x={a.x + 2} y={a.y + 12} fontSize={11} fill="#1c7ed6">
                    {i + 1}
                    {r22[i] ? ` · ${r22[i].category}` : ""}
                  </text>
                </g>
              ))}
            </svg>
            <p className="muted small">Slots used by the in-place layout, left to right ({r20.length} slots, {r22.length} categories).</p>
          </Panel>
          <div className="cta">
            <button className="primary" disabled={!r23.length} onClick={() => go(5)}>
              Annotate →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
