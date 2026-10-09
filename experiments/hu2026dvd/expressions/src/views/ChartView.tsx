import { useMemo, useState } from 'react';
import { CHART_TYPES, type ChartData, type ChartType } from '../../shared/types';
import { LiveCanvas } from '../components/LiveCanvas';
import type { ProjectStore } from '../state';
import { drawChart, parseCsv, translateChart, validateChartData } from '../video/chart';

const TYPE_HELP: Record<ChartType, string> = {
  bar: 'Bars grow one category at a time. First column = categories, other columns = series.',
  line: 'Lines draw from left to right. First column = x values, other columns = series.',
  pie: 'Slices sweep in. First column = slices, second column = values.',
  race: 'Bar chart race. Each row is a time step, each numeric column is a competitor.',
};

/** Process 5: chart_data_1 -> [human specify] chart_type_1 -> [tool_4 translate] -> animated_chart_1 */
export function ChartView({ store }: { store: ProjectStore }) {
  const { project: p, update } = store;
  const [csv, setCsv] = useState('');
  if (!p) return null;
  const data = p.chartData;
  const setData = (chartData: ChartData) => update({ chartData });
  const err = validateChartData(data);

  const setCell = (r: number, c: number, v: string) =>
    setData({ ...data, rows: data.rows.map((row, i) => (i === r ? row.map((x, k) => (k === c ? (c === 0 ? v : v === '' ? '' : Number(v)) : x)) : row)) });

  return (
    <div className="chart-view">
      <section className="panel">
        <h2>Chart data</h2>
        <table className="data-table">
          <thead>
            <tr>
              {data.columns.map((c, ci) => (
                <th key={ci}>
                  <input value={c} onChange={(e) => setData({ ...data, columns: data.columns.map((x, k) => (k === ci ? e.target.value : x)) })} />
                  {ci > 0 && data.columns.length > 2 && (
                    <button className="icon" onClick={() => setData({ columns: data.columns.filter((_, k) => k !== ci), rows: data.rows.map((r) => r.filter((_, k) => k !== ci)) })}>×</button>
                  )}
                </th>
              ))}
              <th><button className="ghost small" onClick={() => setData({ columns: [...data.columns, `Series ${data.columns.length}`], rows: data.rows.map((r) => [...r, 0]) })}>+ col</button></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((v, ci) => (
                  <td key={ci}>
                    <input type={ci === 0 ? 'text' : 'number'} value={v} onChange={(e) => setCell(ri, ci, e.target.value)} />
                  </td>
                ))}
                <td><button className="icon" onClick={() => setData({ ...data, rows: data.rows.filter((_, k) => k !== ri) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="ghost small" onClick={() => setData({ ...data, rows: [...data.rows, data.columns.map((_, k) => (k === 0 ? `Row ${data.rows.length + 1}` : 0))] })}>+ row</button>
        <details>
          <summary>Paste CSV</summary>
          <textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Year,Solar,Wind\n2010,40,180\n2020,710,730'} />
          <button className="small" onClick={() => setData(parseCsv(csv))}>Replace table</button>
        </details>
        {err && <p className="error">⚠ {err}</p>}
      </section>

      <section className="panel">
        <h2>Chart type</h2>
        <div className="segmented">
          {CHART_TYPES.map((t) => (
            <button key={t} className={p.chartType === t ? 'active' : ''} onClick={() => update({ chartType: t })}>{t}</button>
          ))}
        </div>
        {p.chartType && <p className="muted small">{TYPE_HELP[p.chartType]}</p>}
        <h2>Animated chart</h2>
        {p.chartType && !err ? (
          <ChartPreview data={data} type={p.chartType} />
        ) : (
          <div className="player placeholder">{err ? 'Fix the data to preview' : 'Choose a chart type'}</div>
        )}
        <p className="muted small">The animated chart is used in Compose to replace an object in the video.</p>
      </section>
    </div>
  );
}

export function ChartPreview({ data, type }: { data: ChartData; type: ChartType }) {
  const chart = useMemo(() => translateChart(data, type), [data, type]);
  return <LiveCanvas key={JSON.stringify(data) + type} className="player" width={640} height={400} duration={chart.durationSec} draw={(ctx, t, w, h) => drawChart(ctx, chart, t, { x: 0, y: 0, w, h })} />;
}
