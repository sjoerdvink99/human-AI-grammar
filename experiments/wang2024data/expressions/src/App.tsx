import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { assignConcepts, extractConcepts, normalizeCell } from './shared/concepts';
import { programToCode, runReshape } from './shared/reshape';
import { SAMPLES } from './shared/samples';
import { composeExampleRelation, synthesizeReshapes } from './shared/synthesize';
import { specFields, translateToVegaLite, type VegaLiteSpec } from './shared/translate';
import { CHANNELS, type ChartSpec, type CodeCandidate, type Concept, type DerivationRequest, type Row, type Table } from './shared/types';
import { CandidateGallery, type ChartCandidate } from './components/CandidateGallery';
import { ConceptPanel } from './components/ConceptPanel';
import { DataTable } from './components/DataTable';
import { DerivationCandidates } from './components/DerivationCandidates';
import { DerivationForm } from './components/DerivationForm';
import { EncodingShelf } from './components/EncodingShelf';
import { ExampleRelationEditor } from './components/ExampleRelationEditor';
import { VegaChart } from './components/VegaChart';
import { deriveCandidates, deriveApply } from './api';

/** One version of table + concepts (table_1, table_2, … in the design). */
interface Version {
  table: Table;
  concepts: Concept[];
  label: string;
}

interface SavedChart {
  spec: ChartSpec;
  vega: VegaLiteSpec;
  version: number;
}

type Mode =
  | { kind: 'chart' }
  | { kind: 'example'; example: Table; message?: string }
  | { kind: 'candidates'; example: Table; candidates: ChartCandidate[]; tables: Table[] }
  | { kind: 'derive'; initial?: DerivationRequest; editing: boolean }
  | { kind: 'deriveCandidates'; request: DerivationRequest; editing: boolean; prompts: string[]; candidates: CodeCandidate[] };

const EMPTY_SPEC: ChartSpec = { mark: 'point', encodings: {} };

function load(table: Table, label: string): Version {
  // [tool_1 extract]: table_1 -> concepts_1*
  return { table, concepts: extractConcepts(table), label };
}

export default function App() {
  const firstSample = Object.keys(SAMPLES)[0];
  const [versions, setVersions] = useState<Version[]>(() => [load(SAMPLES[firstSample](), firstSample)]);
  const [current, setCurrent] = useState(0);
  const [spec, setSpec] = useState<ChartSpec>(EMPTY_SPEC);
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [activeChart, setActiveChart] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'chart' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { table, concepts } = versions[current];

  const reset = (v: Version) => {
    setVersions([v]);
    setCurrent(0);
    setSpec(EMPTY_SPEC);
    setCharts([]);
    setActiveChart(null);
    setMode({ kind: 'chart' });
    setError(null);
  };

  const pushVersion = (v: Version) => {
    setVersions((vs) => [...vs, v]);
    setCurrent(versions.length);
    return versions.length;
  };

  const setConcepts = (cs: Concept[]) =>
    setVersions((vs) => vs.map((v, i) => (i === current ? { ...v, concepts: cs } : v)));

  const addChart = (c: SavedChart) => {
    setCharts((cs) => [...cs, c]);
    setActiveChart(charts.length);
  };

  // ---- Processes 1 and 3 (chart part), and the entry to process 2 ----
  const formulate = () => {
    setError(null);
    const fields = specFields(spec);
    const missing = fields.filter((f) => !table.columns.includes(f));
    if (missing.length === 0) {
      // [tool_1 translate] -> vega_spec ; [tool_1 execute] happens in <VegaChart>
      addChart({ spec, vega: translateToVegaLite(spec, table, concepts, { width: 520, height: 340 }), version: current });
      setMode({ kind: 'chart' });
    } else {
      // Process 2: [tool_1 compose] -> example_relation_1
      setMode({ kind: 'example', example: composeExampleRelation(spec, table) });
    }
  };

  // Process 2: [tool_2 execute] -> reshaping_programs ; [tool_1 execute] -> candidate_tables ; translate -> candidate charts
  const synthesize = (example: Table) => {
    const { programs, message } = synthesizeReshapes(table, example);
    if (!programs.length) return setMode({ kind: 'example', example, message });
    const tables = programs.map((p) => runReshape(p, table));
    const candidates = programs.map((p, i) => ({
      code: programToCode(p),
      table: tables[i],
      vega: translateToVegaLite(spec, tables[i], concepts, { width: 300, height: 200 }),
    }));
    setMode({ kind: 'candidates', example, candidates, tables });
  };

  // Process 2: [human select] -> table_2 + chart_2 ; [tool_1 assign] -> concepts_2
  const selectCandidate = (m: Extract<Mode, { kind: 'candidates' }>, i: number) => {
    const t = m.tables[i];
    const cs = assignConcepts(t, concepts);
    const idx = pushVersion({ table: t, concepts: cs, label: `reshaped: ${m.candidates[i].code.split('(')[0]}` });
    addChart({ spec, vega: translateToVegaLite(spec, t, cs, { width: 520, height: 340 }), version: idx });
    setMode({ kind: 'chart' });
  };

  // Processes 3/4: [tool_1 compose] -> [model generate]~ -> [tool_1 evaluate]
  const requestCandidates = async (request: DerivationRequest, editing: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { prompts, candidates } = await deriveCandidates(table, concepts, request);
      setMode({ kind: 'deriveCandidates', request, editing, prompts, candidates });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Processes 3/4: [human select] selected_code ; [tool_1 execute] -> table_3/table_4 + concepts_3/concepts_4
  const applyCandidate = async (request: DerivationRequest, c: CodeCandidate) => {
    setBusy(true);
    setError(null);
    try {
      const t = await deriveApply(table, c.code, request.name);
      const derived: Concept = { name: request.name, type: 'quantitative', source: 'derived', derivation: { request, code: c.code } };
      const prev = concepts.some((k) => k.name === request.name)
        ? concepts.map((k) => (k.name === request.name ? derived : k))
        : [...concepts, derived];
      pushVersion({ table: t, concepts: assignConcepts(t, prev), label: `derived: ${request.name}` });
      setMode({ kind: 'chart' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickConcept = (name: string) => {
    const free = CHANNELS.find((ch) => !spec.encodings[ch]);
    if (free) setSpec({ ...spec, encodings: { ...spec.encodings, [free]: { field: name } } });
  };

  const onUpload = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const columns = (res.meta.fields ?? []).filter(Boolean);
        const rows: Row[] = res.data.slice(0, 5000).map((r) => Object.fromEntries(columns.map((c) => [c, normalizeCell(r[c])])));
        if (!columns.length) return setError('Could not read any columns from that file.');
        reset(load({ columns, rows }, file.name));
      },
      error: (e) => setError(e.message),
    });
  };

  const active = activeChart !== null ? charts[activeChart] : null;
  const highlight = useMemo(() => specFields(spec), [spec]);

  return (
    <div className="app">
      <header>
        <h1>System X</h1>
        <span className="muted">concept-driven charts</span>
        <span className="spacer" />
        <label>
          Sample&nbsp;
          <select defaultValue={firstSample} onChange={(e) => reset(load(SAMPLES[e.target.value](), e.target.value))}>
            {Object.keys(SAMPLES).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="upload">
          Upload CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      </header>

      <main>
        <ConceptPanel
          concepts={concepts}
          onAddCustom={(c) => setConcepts([...concepts, c])}
          onRemoveCustom={(n) => setConcepts(concepts.filter((c) => c.name !== n))}
          onDerive={() => setMode({ kind: 'derive', editing: false })}
          onEditDerivation={(c) => setMode({ kind: 'derive', editing: true, initial: c.derivation!.request })}
          onPick={pickConcept}
        />

        <div className="center">
          <EncodingShelf spec={spec} concepts={concepts} onChange={setSpec} onFormulate={formulate} busy={busy} />
          {error && <div className="error panel">{error}</div>}

          {mode.kind === 'chart' && (
            <section className="panel chart-view">
              {active ? (
                <>
                  <VegaChart spec={active.vega} />
                  <div className="muted small">Chart {activeChart! + 1} · data: {versions[active.version]?.label}</div>
                </>
              ) : (
                <p className="muted">Bind concepts to channels and press “Make chart”. Use a new concept to reshape the data by example, or derive one with a description.</p>
              )}
            </section>
          )}
          {mode.kind === 'example' && (
            <ExampleRelationEditor
              example={mode.example}
              concepts={concepts}
              message={mode.message}
              onChange={(example) => setMode({ kind: 'example', example })}
              onSubmit={() => synthesize(mode.example)}
              onCancel={() => setMode({ kind: 'chart' })}
            />
          )}
          {mode.kind === 'candidates' && (
            <CandidateGallery
              candidates={mode.candidates}
              onSelect={(i) => selectCandidate(mode, i)}
              onBack={() => setMode({ kind: 'example', example: mode.example })}
            />
          )}
          {mode.kind === 'derive' && (
            <DerivationForm
              key={mode.initial?.name ?? 'new'}
              concepts={concepts}
              initial={mode.initial}
              editing={mode.editing}
              busy={busy}
              onSubmit={(r) => requestCandidates(r, mode.editing)}
              onCancel={() => setMode({ kind: 'chart' })}
            />
          )}
          {mode.kind === 'deriveCandidates' && (
            <>
              <div className="panel muted small">
                {mode.request.name} = {mode.request.description}{' '}
                <button className="link" onClick={() => setMode({ kind: 'derive', editing: mode.editing, initial: mode.request })}>edit request</button>
              </div>
              <DerivationCandidates
                candidates={mode.candidates}
                prompts={mode.prompts}
                busy={busy}
                onRegenerate={() => requestCandidates(mode.request, mode.editing)}
                onSelect={(c) => applyCandidate(mode.request, c)}
              />
            </>
          )}

          <section className="panel data">
            <div className="row-actions">
              <h2>Data</h2>
              <select value={current} onChange={(e) => setCurrent(Number(e.target.value))}>
                {versions.map((v, i) => <option key={i} value={i}>v{i + 1} · {v.label}</option>)}
              </select>
              <span className="muted small">{table.rows.length} rows × {table.columns.length} columns</span>
            </div>
            <DataTable table={table} maxRows={50} highlight={highlight} />
          </section>
        </div>

        <aside className="panel history">
          <h2>Charts</h2>
          {charts.length === 0 && <p className="muted small">No charts yet.</p>}
          {charts.map((c, i) => (
            <button
              key={i}
              className={`chart-thumb ${i === activeChart ? 'active' : ''}`}
              onClick={() => {
                setActiveChart(i);
                setSpec(c.spec);
                setCurrent(c.version);
                setMode({ kind: 'chart' });
              }}
            >
              <b>Chart {i + 1}</b> · {c.spec.mark}
              <div className="muted small">
                {Object.entries(c.spec.encodings).map(([ch, e]) => `${ch}: ${e?.field}`).join(', ')}
              </div>
              <div className="muted small">data v{c.version + 1}</div>
            </button>
          ))}
        </aside>
      </main>
    </div>
  );
}
