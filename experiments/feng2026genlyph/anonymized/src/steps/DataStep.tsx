import { useMemo, useState } from "react";
import type { StepProps } from "../App.tsx";
import { Panel, SvgView } from "../components.tsx";
import { SAMPLES, sampleDataset } from "../sample.ts";
import { parseCsv } from "../tools/csv.ts";
import { profileData, describeProfile, fmt } from "../tools/profile.ts";
import { baseChartSvg } from "../tools/basechart.ts";
import { runProcess1 } from "../pipelines.ts";
import type { Dataset } from "../types.ts";
import { initialState } from "../store.ts";

export default function DataStep({ state, update, go }: StepProps) {
  const [error, setError] = useState("");
  const [count, setCount] = useState(4);
  const r1 = state.r1;
  // preview of the tool steps r2/r3/r6 (the stored values are produced when Process 1 runs)
  const preview = useMemo(() => {
    if (!r1) return null;
    const r2 = profileData(r1);
    return { r2, r3: describeProfile(r2, r1.name), r6: baseChartSvg(r1, r2) };
  }, [r1]);

  const setData = (d: Dataset) => {
    setError("");
    // a new r1 invalidates everything derived from the previous table
    update(() => ({ ...initialState, r1: d }));
  };

  const onFile = async (f: File) => {
    try {
      setData(parseCsv(await f.text(), f.name));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const start = () => {
    if (!r1) return;
    go(1);
    void runProcess1(r1, update, count);
  };

  return (
    <div className="step">
      <h2>1 · Load a table</h2>
      <p className="lead">
        Start from a dataset <code className="tag">r1</code>. The system profiles it, brainstorms visual metaphors, and draws
        candidate illustrations whose objects can later stand in for your data.
      </p>
      <Panel title="Dataset" tag="r1 · artifact tabular">
        <div className="row gap">
          <label className="file">
            Upload CSV
            <input type="file" accept=".csv,.tsv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <span className="muted">or try</span>
          {(Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]).map((k) => (
            <button key={k} className="ghost" onClick={() => setData(sampleDataset(k))}>
              {k}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        {r1 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {r1.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r1.rows.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    {r1.columns.map((c) => (
                      <td key={c} className={typeof row[c] === "number" ? "num" : ""}>
                        {row[c] === null ? "" : typeof row[c] === "number" ? fmt(row[c] as number) : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {r1.rows.length > 50 && <p className="muted">…and {r1.rows.length - 50} more rows</p>}
          </div>
        )}
      </Panel>
      {preview && (
        <div className="grid2">
          <Panel title="Profile" tag="r2 · record → r3 · language">
            <ul className="profile">
              {preview.r2.columns.map((c) => (
                <li key={c.name}>
                  <b>{c.name}</b> <span className={`pill ${c.type}`}>{c.type}</span>{" "}
                  <span className="muted">
                    {c.type === "number" ? `${fmt(c.min!)}–${fmt(c.max!)}` : `${c.distinct} values`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="prose small">{preview.r3}</p>
          </Panel>
          <Panel title="Data shape" tag="r6 · visual">
            <SvgView svg={preview.r6.svg} />
          </Panel>
        </div>
      )}
      <div className="cta">
        <label>
          Illustrations per round{" "}
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!r1 || state.r4Status === "pending"} onClick={start}>
          Brainstorm &amp; illustrate →
        </button>
      </div>
    </div>
  );
}
