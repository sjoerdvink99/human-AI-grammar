import { useApp } from "../App";
import { chooseColumns, renderChart } from "../../shared/chart";
import { parseTable } from "../../shared/table";
import { CHART_TYPES, type ChartType } from "../../shared/types";
import { download, svgDataUrl } from "../tools/raster";

/** Process 5: table r16 → [human specify] chart type r17 → [tool_4 translate] chart r18. */
export function ChartPanel() {
  const { state, dispatch } = useApp();
  const t = state.table;
  const cols = t ? chooseColumns(t) : null;

  function setText(tableText: string) {
    const table = parseTable(tableText);
    const chart = state.chartType && table.columns.length ? renderChart(table, state.chartType) : null;
    dispatch({ type: "set", patch: { tableText, table, chart } });
  }
  function choose(chartType: ChartType) {
    if (!t) return;
    dispatch({ type: "set", patch: { chartType, chart: renderChart(t, chartType) } });
  }

  return (
    <div className="two-col">
      <section>
        <div className="block-head">
          <h2>Data table</h2>
          <label className="ghost small filebtn">
            Upload CSV
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
              }}
            />
          </label>
        </div>
        <textarea
          rows={7}
          className="mono"
          placeholder={"label,value\nA,10\nB,20"}
          value={state.tableText}
          onChange={(e) => setText(e.target.value)}
        />
        {t && t.columns.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {t.columns.map((c, i) => (
                    <th key={i} className={cols && (i === cols.label || i === cols.value) ? "used" : ""}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={typeof v === "number" ? "num" : ""}>
                        {String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cols && t && (
          <p className="muted small">
            Labels: <b>{cols.label >= 0 ? t.columns[cols.label] : "row number"}</b> · values: <b>{t.columns[cols.value]}</b>
            {state.chartType === "scatter" && (
              <>
                {" "}· y: <b>{t.columns[cols.value2]}</b>
              </>
            )}
          </p>
        )}
      </section>
      <section>
        <h2>Chart type</h2>
        <div className="segmented">
          {CHART_TYPES.map((c) => (
            <button key={c} className={state.chartType === c ? "active" : ""} disabled={!t || !t.columns.length} onClick={() => choose(c)}>
              {c}
            </button>
          ))}
        </div>
        {state.chart ? (
          <>
            <img className="chart-img" src={svgDataUrl(state.chart.svg)} alt="Chart" />
            <button className="ghost small" onClick={() => download("chart.svg", state.chart!.svg)}>
              Download SVG
            </button>
          </>
        ) : (
          <p className="muted">Paste or upload a table, then pick a chart type.</p>
        )}
      </section>
    </div>
  );
}
