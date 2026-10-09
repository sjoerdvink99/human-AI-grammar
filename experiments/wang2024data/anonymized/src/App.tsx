import { useMemo, useState } from 'react';
import type { Concept, DeriveRequest, Encoding, FieldMeta, Table } from './types';
import { SAMPLES, parseFile } from './data';
import { assignFields, extractFields } from './tools/extract';
import { lookupFromFields, translateToSpec } from './tools/translate';
import { FieldPanel } from './components/FieldPanel';
import { EncodingShelf } from './components/EncodingShelf';
import { Chart } from './components/Chart';
import { DataTable } from './components/DataTable';
import { FormulatePanel } from './components/FormulatePanel';
import { DerivePanel } from './components/DerivePanel';
import { Code } from './components/Code';

interface Version {
  label: string;
  table: Table;
  fields: FieldMeta[];
}

type Panel = { kind: 'none' } | { kind: 'formulate' } | { kind: 'derive'; initial?: DeriveRequest; key: number };

const EMPTY_ENCODING: Encoding = { mark: 'bar', channels: {}, aggregate: {} };

export function App() {
  const first = SAMPLES['Fruit sales (wide)']();
  // r1 — working table, and r2 — field metadata ([tool_1 extract] on load)
  const [table, setTable] = useState<Table>(first);
  const [fields, setFields] = useState<FieldMeta[]>(() => extractFields(first));
  const [history, setHistory] = useState<Version[]>(() => [{ label: `loaded ${first.name}`, table: first, fields: extractFields(first) }]);
  // r6 — new concepts
  const [concepts, setConcepts] = useState<Concept[]>([]);
  // r3 — encoding
  const [encoding, setEncoding] = useState<Encoding>(EMPTY_ENCODING);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [showSpec, setShowSpec] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const commit = (t: Table, f: FieldMeta[], label: string) => {
    setTable(t);
    setFields(f);
    setHistory((h) => [...h, { label, table: t, fields: f }]);
  };

  const load = (t: Table) => {
    const f = extractFields(t); // [tool_1 extract]: r1 -> r2*
    setHistory([{ label: `loaded ${t.name}`, table: t, fields: f }]);
    setTable(t);
    setFields(f);
    setConcepts([]);
    setEncoding(EMPTY_ENCODING);
    setPanel({ kind: 'none' });
  };

  const onFile = async (file: File) => {
    try {
      setLoadError(null);
      load(parseFile(file.name, await file.text()));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  const used = Object.values(encoding.channels).filter((v): v is string => !!v);
  const missing = used.filter((u) => !table.columns.includes(u));
  const missingConcepts = missing.filter((m) => concepts.some((c) => c.name === m));

  // [tool_1 translate]: r3 + r2 -> r4
  const spec = useMemo(() => (missing.length ? null : translateToSpec(encoding, lookupFromFields(fields))), [encoding, fields, missing.length]);

  // P2 [human select] -> r1_2 + r5_2, then [tool_1 assign] -> r2_2
  const onFormulated = (t: Table) => {
    const f = assignFields(t, fields, 'reshaped');
    const channels = Object.fromEntries(Object.entries(encoding.channels).filter(([, v]) => v && t.columns.includes(v)));
    commit(t, f, `reshaped (${missingConcepts.join(', ')})`);
    setConcepts((cs) => cs.filter((c) => !t.columns.includes(c.name)));
    setEncoding({ ...encoding, channels });
    setPanel({ kind: 'none' });
  };

  // P3/P4 [tool_1 execute] -> r1_3/r1_4 + r2_3/r2_4
  const onDerived = (t: Table, request: DeriveRequest, code: string) => {
    const f = assignFields(t, fields, 'derived').map((x) =>
      x.name === request.name ? { ...x, source: 'derived' as const, derivation: { request, code } } : x,
    );
    commit(t, f, `${fields.some((x) => x.name === request.name) ? 'redefined' : 'derived'} ${request.name}`);
  };

  const revert = (i: number) => {
    const v = history[i];
    setTable(v.table);
    setFields(v.fields);
    setHistory(history.slice(0, i + 1));
  };

  const options = [...fields.map((f) => f.name), ...concepts.map((c) => c.name)];

  return (
    <div className="app">
      <header>
        <h1>System X</h1>
        <span className="muted">concept-driven chart authoring</span>
        <div className="spacer" />
        <select value="" onChange={(e) => e.target.value && load(SAMPLES[e.target.value]())}>
          <option value="">Load sample…</option>
          {Object.keys(SAMPLES).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <label className="file">
          Upload CSV/JSON
          <input type="file" accept=".csv,.json,.tsv,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </header>
      {loadError && <div className="error">{loadError}</div>}
      <main>
        <aside>
          <div className="muted small">Table: {table.name}</div>
          <FieldPanel
            fields={fields}
            concepts={concepts}
            onAddConcept={(n) => setConcepts([...concepts, { name: n }])}
            onRemoveConcept={(n) => {
              setConcepts(concepts.filter((c) => c.name !== n));
              setEncoding({ ...encoding, channels: Object.fromEntries(Object.entries(encoding.channels).filter(([, v]) => v !== n)) });
            }}
            onDerive={() => setPanel({ kind: 'derive', key: Date.now() })}
            onEditDerived={(f) => setPanel({ kind: 'derive', initial: f.derivation?.request, key: Date.now() })}
          />
          <h3>Data versions</h3>
          <ol className="versions">
            {history.map((v, i) => (
              <li key={i} className={i === history.length - 1 ? 'current' : ''}>
                {v.label}
                {i < history.length - 1 && (
                  <button className="link" onClick={() => revert(i)}>
                    revert
                  </button>
                )}
              </li>
            ))}
          </ol>
        </aside>
        <section className="center">
          <EncodingShelf encoding={encoding} options={options} onChange={setEncoding} />
          {missing.length > 0 ? (
            <div className="notice">
              {missingConcepts.length === missing.length ? (
                <>
                  The shelves use new concept{missing.length > 1 ? 's' : ''} <b>{missing.join(', ')}</b> that the table doesn't have yet.
                  <button className="primary" onClick={() => setPanel({ kind: 'formulate' })}>
                    Formulate data by example…
                  </button>
                </>
              ) : (
                <>Fields not in the table: {missing.join(', ')}. Remove them from the shelves.</>
              )}
            </div>
          ) : (
            <Chart spec={spec} rows={table.rows} />
          )}
          {spec && (
            <div className="section">
              <button className="link" onClick={() => setShowSpec(!showSpec)}>
                {showSpec ? '▾' : '▸'} Vega-Lite spec
              </button>
              {showSpec && <Code code={JSON.stringify(spec, null, 2)} maxHeight={260} />}
            </div>
          )}
          <h3>
            Data <span className="muted small">({table.rows.length} rows)</span>
          </h3>
          <DataTable table={table} fields={fields} />
        </section>
        {panel.kind === 'formulate' && (
          <FormulatePanel table={table} fields={fields} encoding={encoding} onSelect={onFormulated} onClose={() => setPanel({ kind: 'none' })} />
        )}
        {panel.kind === 'derive' && (
          <DerivePanel
            key={panel.key}
            table={table}
            fields={fields}
            initial={panel.initial}
            onApply={onDerived}
            onClose={() => setPanel({ kind: 'none' })}
          />
        )}
      </main>
    </div>
  );
}
