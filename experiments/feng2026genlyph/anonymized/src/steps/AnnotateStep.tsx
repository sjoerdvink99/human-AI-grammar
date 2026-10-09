import { useMemo } from "react";
import type { StepProps } from "../App.tsx";
import { Panel, SvgView } from "../components.tsx";
import { deriveCharts } from "../derive.ts";
import { matchRows } from "../tools/match.ts";
import { finalizeChart } from "../tools/finalize.ts";
import { fmt } from "../tools/profile.ts";
import type { FinalSpec, MatchQuery } from "../types.ts";

const OPS: MatchQuery["op"][] = ["max", "min", "=", "!=", ">", "<", ">=", "<=", "contains"];

export default function AnnotateStep({ state, update, go }: StepProps) {
  const { r23 } = useMemo(() => deriveCharts(state), [state.r1, state.r13, state.r14, state.r19, state.r21]);
  const r1 = state.r1!;
  const q = state.r24.field ? state.r24 : { ...state.r24, field: state.r21?.valueField || r1.columns[0] };
  const setQuery = (patch: Partial<MatchQuery>) => update((s) => ({ ...s, r24: { ...q, ...patch } }));
  const setFinal = (patch: Partial<FinalSpec>) => update((s) => ({ ...s, r26: { ...s.r26, ...patch } }));
  const r26 = { ...state.r26, chartIndex: Math.min(state.r26.chartIndex, Math.max(r23.length - 1, 0)) };

  // Process 7 · tool_4 match: r24 + r1 -> r25
  const find = () => {
    const r25 = matchRows(r1, q, r23);
    update((s) => ({ ...s, r24: q, r25, r26: { ...s.r26, annotate: r25.categories.map((c) => c.category) } }));
  };

  // Process 7 · tool_3 compose: r26 + r23* -> r27 (live, so editing r26 loops back immediately)
  const r27 = useMemo(() => {
    try {
      return r23.length ? finalizeChart(r23, r26) : "";
    } catch {
      return "";
    }
  }, [r23, r26]);

  const toggle = (c: string) =>
    setFinal({ annotate: r26.annotate.includes(c) ? r26.annotate.filter((x) => x !== c) : [...r26.annotate, c] });

  return (
    <div className="step">
      <h2>6 · Annotate</h2>
      <div className="grid-side">
        <Panel title="Final chart" tag="r27 · visual">
          {r27 ? <SvgView svg={r27} className="final" /> : <p className="muted">No chart available.</p>}
          <div className="cta">
            <button className="primary" disabled={!r27} onClick={() => go(6)}>
              Export →
            </button>
          </div>
        </Panel>
        <div>
          <Panel title="Find data to highlight" tag="r24 · instruction record">
            <div className="row gap wrap">
              <select value={q.field} onChange={(e) => setQuery({ field: e.target.value })}>
                {r1.columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select value={q.op} onChange={(e) => setQuery({ op: e.target.value as MatchQuery["op"] })}>
                {OPS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              {q.op !== "max" && q.op !== "min" && <input placeholder="value" value={q.value} onChange={(e) => setQuery({ value: e.target.value })} />}
              <button onClick={find}>Find</button>
            </div>
          </Panel>
          <Panel title="Matches" tag="r25 · record → r26 · selection">
            {!state.r25 && <p className="muted">Run a query to find rows; the categories they fall in can be annotated.</p>}
            {state.r25 && (
              <>
                <p className="muted small">
                  {state.r25.rowIndices.length} matching rows in {state.r25.categories.length} categories.
                </p>
                <ul className="checks">
                  {state.r25.categories.map((c) => (
                    <li key={c.category}>
                      <label className="check">
                        <input type="checkbox" checked={r26.annotate.includes(c.category)} onChange={() => toggle(c.category)} />
                        <b>{c.category}</b> <span className="muted">{fmt(c.value)} · {c.rows} rows</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
          <Panel title="Final settings" tag="r26 · instruction record">
            <div className="form">
              <label>
                Chart
                <select value={r26.chartIndex} onChange={(e) => setFinal({ chartIndex: Number(e.target.value) })}>
                  {r23.map((c, i) => (
                    <option key={c.layout} value={i}>
                      {c.layout}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input value={r26.title} onChange={(e) => setFinal({ title: e.target.value })} />
              </label>
              <label>
                Subtitle
                <input value={r26.subtitle} onChange={(e) => setFinal({ subtitle: e.target.value })} />
              </label>
              <label>
                Source / note
                <input value={r26.note} onChange={(e) => setFinal({ note: e.target.value })} />
              </label>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
