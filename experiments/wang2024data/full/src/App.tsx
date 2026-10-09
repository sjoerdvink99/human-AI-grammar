import { useMemo, useReducer, useState } from 'react';
import Papa from 'papaparse';
import type { Concept, ReshapeCandidate, Row } from '../shared/types';
import { parseCell } from '../shared/concepts';
import { specFields, toVegaLite } from '../shared/vega';
import { programToCode } from '../shared/synth';
import { allConcepts, currentVersion, initialState, reducer } from './state';
import { SAMPLES } from './samples';
import { ConceptShelf } from './components/ConceptShelf';
import { ChartBuilder } from './components/ChartBuilder';
import { VegaChart } from './components/VegaChart';
import { DataTable } from './components/DataTable';
import { ReshapeDialog } from './components/ReshapeDialog';
import { DerivePanel } from './components/DerivePanel';
import { Code } from './components/Code';

function normalizeRows(raw: Record<string, unknown>[]): { columns: string[]; rows: Row[] } {
  const columns = [...new Set(raw.flatMap((r) => Object.keys(r)))].filter((c) => c.trim() !== '');
  const rows = raw.map((r) => Object.fromEntries(columns.map((c) => [c, parseCell(r[c])])));
  return { columns, rows };
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [reshapeOpen, setReshapeOpen] = useState(false);
  const [derive, setDerive] = useState<{ refine?: Concept } | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const version = currentVersion(state);
  const concepts = allConcepts(state);
  const spec = state.chartSpec;
  const fields = specFields(spec);
  const missing = version ? fields.filter((f) => !version.table.columns.includes(f)) : [];
  const missingCustom = missing.filter((f) => state.customConcepts.some((c) => c.name === f));
  const missingOther = missing.filter((f) => !missingCustom.includes(f));

  // [tool_1 translate]: chart_spec -> vega_spec (only when no transformation is needed)
  const vegaSpec = useMemo(
    () => (version && fields.length > 0 && missing.length === 0 ? toVegaLite(spec, version.table.rows, version.concepts, { width: 480, height: 320 }) : null),
    [version, spec, fields.length, missing.length],
  );

  const loadRows = (name: string, raw: Record<string, unknown>[]) => {
    const { columns, rows } = normalizeRows(raw);
    if (columns.length === 0 || rows.length === 0) {
      setLoadError('The file has no rows or columns.');
      return;
    }
    setLoadError(null);
    dispatch({ type: 'LOAD_TABLE', name, columns, rows });
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('JSON must be an array of objects');
        loadRows(file.name, data);
      } else {
        const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
        loadRows(file.name, parsed.data);
      }
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  const acceptReshape = (c: ReshapeCandidate) => {
    dispatch({ type: 'ACCEPT_RESHAPE', columns: c.table.columns, rows: c.table.rows, origin: `reshaped: ${programToCode(c.program).split('(')[0]}` });
    setReshapeOpen(false);
  };

  return (
    <div className="app">
      <header>
        <h1>System X</h1>
        <span className="muted">visualization authoring with data concepts</span>
        <div className="spacer" />
        <select
          value=""
          onChange={(e) => {
            const s = SAMPLES.find((x) => x.name === e.target.value);
            if (s) loadRows(s.name, s.rows());
          }}
        >
          <option value="">Load sample table…</option>
          {SAMPLES.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} — {s.description}
            </option>
          ))}
        </select>
        <label className="file">
          Upload CSV / JSON
          <input type="file" accept=".csv,.json,.tsv,text/csv,application/json" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </header>
      {loadError && <div className="error banner">{loadError}</div>}

      {!version ? (
        <div className="empty">
          <h2>Start by loading a data table</h2>
          <p>Pick a sample table or upload a CSV/JSON file. Its columns become concepts you can place on chart channels.</p>
        </div>
      ) : (
        <main>
          <ConceptShelf
            concepts={concepts}
            disabled={!version}
            onAddCustom={(c) => dispatch({ type: 'ADD_CUSTOM', concept: c })}
            onRemoveCustom={(name) => dispatch({ type: 'REMOVE_CUSTOM', name })}
            onDerive={() => setDerive({})}
            onRefine={(c) => setDerive({ refine: c })}
          />

          <section className="panel center">
            <h2>Chart</h2>
            <ChartBuilder spec={spec} concepts={concepts} onChange={(s) => dispatch({ type: 'SET_SPEC', spec: s })} />
            <div className="chart-area">
              {fields.length === 0 && <div className="muted">Drag concepts onto channels to build a chart.</div>}
              {missingCustom.length > 0 && (
                <div className="notice">
                  <p>
                    {missingCustom.map((m) => `“${m}”`).join(', ')} {missingCustom.length > 1 ? 'are' : 'is'} not in the table yet. Show with a few
                    examples how the chart's concepts relate, and the table will be reshaped to contain them.
                  </p>
                  <button onClick={() => setReshapeOpen(true)}>Formulate by example…</button>
                </div>
              )}
              {missingOther.length > 0 && (
                <div className="error">{missingOther.join(', ')} not in table version {version.table.version}. Pick another concept or switch versions.</div>
              )}
              {vegaSpec && (
                <>
                  <VegaChart spec={vegaSpec} />
                  <div className="row">
                    <button className="secondary" onClick={() => dispatch({ type: 'SAVE_CHART' })}>
                      Save chart
                    </button>
                    <button className="link" onClick={() => setShowSpec(!showSpec)}>
                      {showSpec ? 'hide' : 'show'} Vega-Lite spec
                    </button>
                  </div>
                  {showSpec && <Code lang="json" code={JSON.stringify({ ...vegaSpec, data: { values: `[${version.table.rows.length} rows]` } }, null, 2)} maxHeight={300} />}
                </>
              )}
            </div>
            {state.savedCharts.length > 0 && (
              <>
                <h3>Saved charts</h3>
                <div className="gallery">
                  {state.savedCharts.map((c) => {
                    const v = state.versions[c.tableVersion];
                    return (
                      <div key={c.id} className="thumb">
                        <VegaChart spec={toVegaLite(c.spec, v.table.rows, v.concepts, { width: 180, height: 120 })} />
                        <div className="row">
                          <button className="link" onClick={() => { dispatch({ type: 'SELECT_VERSION', index: c.tableVersion }); dispatch({ type: 'SET_SPEC', spec: c.spec }); }}>
                            open
                          </button>
                          <button className="link" onClick={() => dispatch({ type: 'DELETE_CHART', id: c.id })}>
                            delete
                          </button>
                          <span className="muted small">table v{v.table.version}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <section className="panel data">
            <h2>Data</h2>
            <div className="versions">
              {state.versions.map((v, i) => (
                <button key={v.table.id} className={`version ${i === state.current ? 'active' : ''}`} onClick={() => dispatch({ type: 'SELECT_VERSION', index: i })} title={v.table.origin}>
                  v{v.table.version} <span className="muted small">{v.table.origin}</span>
                </button>
              ))}
            </div>
            <div className="muted small">
              {version.table.name}: {version.table.rows.length} rows × {version.table.columns.length} columns
            </div>
            <DataTable columns={version.table.columns} rows={version.table.rows} concepts={version.concepts} highlight={fields} />
          </section>
        </main>
      )}

      {reshapeOpen && version && (
        <ReshapeDialog table={version.table} spec={spec} concepts={concepts} onAccept={acceptReshape} onClose={() => setReshapeOpen(false)} />
      )}
      {derive && version && (
        <DerivePanel
          table={version.table}
          concepts={version.concepts}
          refine={derive.refine}
          onClose={() => setDerive(null)}
          onApply={(request, code, values) => {
            dispatch({ type: 'APPLY_DERIVATION', request, code, values, refine: !!derive.refine });
            setDerive(null);
          }}
        />
      )}
    </div>
  );
}
