// Pipeline trace: every transformation of a process with its output representation,
// rendered according to the representation's medium.
import type { StepEvent } from './api.ts';
import { AXES, type Graph } from '../../shared/types.ts';

export interface TraceItem { rep: string; transform: string; output?: unknown; ms?: number; running: boolean }

export function traceReducer(items: TraceItem[], e: StepEvent): TraceItem[] {
  if (e.type === 'start') return [...items, { rep: e.rep, transform: e.transform, running: true }];
  return items.map((it) => (it.running && it.rep === e.rep ? { ...it, output: e.output, ms: e.ms, running: false } : it));
}

const MEDIUM: Record<string, string> = {
  r4: 'numeric', r5: 'selection*', r6: 'tabular', r7: 'selection*', r8: 'tabular', r9: 'selection*', 'r10+r11': 'record', r12: 'record',
  r13: 'graph', 'r14+r15': 'spatial', r19: 'record', r20: 'record', r21: 'record*', r14: 'spatial',
  r22: 'record', r23: 'tabular', r24: 'graph', r25: 'graph', r26: 'graph', r27: 'language*', r28: 'record*', r2_2: 'record',
  r29: 'visual', r30: 'categorical*', r31: 'numeric*', r3_2: 'record',
};

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <em>empty</em>;
  const cols = Object.keys(rows[0]).filter((c) => typeof rows[0][c] !== 'object');
  return (
    <table><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>)}</tbody></table>
  );
}

function Bars({ values, labels }: { values: number[]; labels: readonly string[] }) {
  return <div className="bars">{values.map((v, i) => (
    <div key={i} className="bar"><span>{labels[i]}</span><i style={{ width: `${v * 100}%` }} /><b>{v.toFixed(2)}</b></div>
  ))}</div>;
}

function GraphOutline({ g }: { g: Graph }) {
  const label = (id: string) => { const n = g.nodes.find((x) => x.id === id); const name = (n?.data as { name?: string } | undefined)?.name; return name ? `${n!.id}: ${name}` : n?.label ?? id; };
  const members = g.edges.filter((e) => e.relation === 'member' || e.relation === 'contains');
  const parents = [...new Set(members.map((e) => e.source))];
  const other = g.edges.filter((e) => e.relation !== 'member' && e.relation !== 'contains');
  return (
    <div className="graph">
      {parents.length > 0 && <ul>{parents.map((p) => <li key={p}><b>{label(p)}</b>
        <ul>{members.filter((e) => e.source === p).map((e) => <li key={e.target}>{label(e.target)}</li>)}</ul></li>)}</ul>}
      {other.length > 0 && <ul className="edges">{other.map((e, i) => <li key={i}>{label(e.source)} <i>{e.relation}</i> {label(e.target)}</li>)}</ul>}
      {!g.nodes.length && <em>no nodes</em>}
    </div>
  );
}

function Output({ rep, output }: { rep: string; output: unknown }) {
  const m = MEDIUM[rep] ?? 'record';
  if (rep === 'r4' && Array.isArray(output)) return <Bars values={output as number[]} labels={AXES} />;
  if (rep === 'r31' && Array.isArray(output)) return <Bars values={(output as { score: number }[]).map((s) => s.score)} labels={(output as { assetId: string }[]).map((s) => s.assetId)} />;
  if (m === 'graph') return <GraphOutline g={output as Graph} />;
  if (rep === 'r29') return <div className="thumbs">{Object.entries(output as Record<string, string>).map(([id, svg]) => <figure key={id}><div dangerouslySetInnerHTML={{ __html: svg }} /><figcaption>{id}</figcaption></figure>)}{!Object.keys(output as object).length && <em>nothing new to render</em>}</div>;
  if (rep === 'r27') return <ul>{(output as { text: string }[]).map((d, i) => <li key={i}>{d.text}</li>)}{!(output as unknown[]).length && <em>no coherent arrangements</em>}</ul>;
  if (rep === 'r30') return <ul>{(output as { assetId: string; verdict: string; reason: string }[]).map((j) => <li key={j.assetId}><span className={`verdict ${j.verdict}`}>{j.verdict}</span> {j.assetId} — {j.reason}</li>)}</ul>;
  if (rep === 'r20') { const o = output as { action: string; targets: string[]; explanation: string; parameters: unknown }; return <div><b>{o.action}</b> → {o.targets.join(', ')}<div className="muted">{o.explanation}</div><code>{JSON.stringify(o.parameters)}</code></div>; }
  if (rep === 'r21') return <ol className="ops">{(output as object[]).map((o, i) => <li key={i}><code>{JSON.stringify(o)}</code></li>)}</ol>;
  if ((m === 'tabular' || m.endsWith('*')) && Array.isArray(output)) return <Table rows={output as Record<string, unknown>[]} />;
  if (rep === 'r14' || rep === 'r14+r15') { const n = Array.isArray(output) ? output.length : (output as { layout: unknown[] }).layout.length; return <span>{n} placed objects (see plan)</span>; }
  if (rep === 'r2_2') { const o = output as { library: { version: number; assets: unknown[] }; added: string[] }; return <span>library v{o.library.version}: {o.library.assets.length} assets, added {o.added.join(', ') || 'none'}</span>; }
  return <pre>{JSON.stringify(output, null, 1).slice(0, 3000)}</pre>;
}

export function TracePanel({ title, items }: { title: string; items: TraceItem[] }) {
  if (!items.length) return null;
  return (
    <section className="trace">
      <h3>{title}</h3>
      {items.map((it, i) => (
        <details key={i} open={it.running || i === items.length - 1}>
          <summary>
            <span className={`actor ${it.transform.split(' ')[0].replace(/_\d+$/, '')}`}>[{it.transform}]</span> → <b>{it.rep}</b>
            <span className="medium">{MEDIUM[it.rep]}</span>
            {it.running ? <span className="spin">running…</span> : <span className="ms">{it.ms} ms</span>}
          </summary>
          {!it.running && <div className="out"><Output rep={it.rep} output={it.output} /></div>}
        </details>
      ))}
    </section>
  );
}
