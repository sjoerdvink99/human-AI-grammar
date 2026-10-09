import { useCallback, useEffect, useReducer, useState } from 'react';
import type { Judgement, Layout, Library, Reliability, Scene, SceneView, SpatialSelection } from '../../shared/types.ts';
import { runStream } from './api.ts';
import { LibraryPanel } from './LibraryPanel.tsx';
import { SceneCanvas } from './SceneCanvas.tsx';
import { TracePanel, traceReducer, type TraceItem } from './TracePanel.tsx';
import { VoiceInput } from './VoiceInput.tsx';

interface Current { scene: Scene; layout: Layout; view: SceneView; history: Layout[] }
const SAVED = 'systemx.current';
const EXAMPLES = [
  'A cozy reading corner with a bookshelf, an armchair next to a floor lamp, and a plant',
  'A small home office with a desk against the wall, an office chair and a whiteboard',
  'A family dining room with a table for six, a rug and a plant in the corner',
  'A kids bedroom with a single bed, a toy chest and a play mat in the middle',
];

type Busy = null | 'p1' | 'p2' | 'p3';
const traces = (s: Record<string, TraceItem[]>, a: { key: string; e?: Parameters<typeof traceReducer>[1]; reset?: boolean }) =>
  ({ ...s, [a.key]: a.reset ? [] : traceReducer(s[a.key] ?? [], a.e!) });

export function App() {
  const [request, setRequest] = useState(''); // r1
  const [lib, setLib] = useState<{ library: Library; reliability: Reliability } | null>(null); // r2 + r3
  const [cur, setCur] = useState<Current | null>(() => { try { return JSON.parse(localStorage.getItem(SAVED) ?? 'null'); } catch { return null; } });
  const [selection, setSelection] = useState<SpatialSelection>({ objectIds: [] }); // r16
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, dispatch] = useReducer(traces, {});
  const [lastLearn, setLastLearn] = useState<{ added: string[]; judgements: Judgement[] } | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  const loadLibrary = useCallback(() => fetch('/api/library').then((r) => r.json()).then(setLib), []);
  useEffect(() => { loadLibrary(); }, [loadLibrary]);
  useEffect(() => { if (cur) localStorage.setItem(SAVED, JSON.stringify(cur)); else localStorage.removeItem(SAVED); }, [cur]);
  useEffect(() => { if (cur && !request) setRequest(cur.scene.request); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------ Process 1
  const compose = async () => {
    setBusy('p1'); setError(null); dispatch({ key: 'p1', reset: true }); dispatch({ key: 'p2', reset: true }); dispatch({ key: 'p3', reset: true });
    try {
      const res = await runStream<{ scene: Scene; layout: Layout; view: SceneView }>('/api/process1', { request }, (e) => dispatch({ key: 'p1', e }));
      setCur({ ...res, history: [] }); setSelection({ objectIds: [] }); setLastLearn(null); setLastCommand(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  // ------------------------------------------------ Process 2 (r18 arrives from VoiceInput)
  const command = async (transcript: string) => {
    if (!cur) return;
    setBusy('p2'); setError(null); dispatch({ key: 'p2', reset: true }); setLastCommand(transcript);
    try {
      const res = await runStream<{ layout: Layout; view: SceneView }>('/api/process2', { transcript, selection, scene: cur.scene, layout: cur.layout, view: cur.view }, (e) => dispatch({ key: 'p2', e }));
      setCur({ ...cur, layout: res.layout, view: res.view, history: [...cur.history, cur.layout].slice(-30) });
      setSelection((s) => ({ objectIds: s.objectIds.filter((id) => res.layout.some((o) => o.id === id)) }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const undo = () => { if (cur?.history.length) setCur({ ...cur, layout: cur.history[cur.history.length - 1], history: cur.history.slice(0, -1), view: { ...cur.view, editLog: cur.view.editLog.slice(0, -1) } }); };

  // ------------------------------------------------ Process 3
  const learn = async () => {
    if (!cur) return;
    setBusy('p3'); setError(null); dispatch({ key: 'p3', reset: true });
    try {
      const res = await runStream<{ library: Library; reliability: Reliability; added: string[]; judgements: Judgement[] }>('/api/process3', { scene: cur.scene, layout: cur.layout, view: cur.view }, (e) => dispatch({ key: 'p3', e }));
      setLib({ library: res.library, reliability: res.reliability }); setLastLearn({ added: res.added, judgements: res.judgements });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const reset = async () => { if (!confirm('Reset the library and reliability model to their seed state?')) return; await fetch('/api/reset', { method: 'POST' }); loadLibrary(); setLastLearn(null); };

  return (
    <div className="app">
      <header>
        <h1>System X <span>scene composer</span></h1>
        <nav className="steps">
          <span className={busy === 'p1' ? 'active' : ''}>1 · Compose</span>
          <span className={busy === 'p2' ? 'active' : ''}>2 · Edit by voice</span>
          <span className={busy === 'p3' ? 'active' : ''}>3 · Learn</span>
        </nav>
        <button className="link" onClick={reset}>reset library</button>
      </header>

      <aside className="left">
        <section className="request">
          <h3>Describe a scene <span className="muted">r1</span></h3>
          <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={4} placeholder="e.g. a cozy reading corner with an armchair next to a floor lamp" disabled={!!busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) compose(); }} />
          <div className="row">
            <button className="primary" onClick={compose} disabled={!!busy || request.trim().length < 3}>{busy === 'p1' ? 'Composing…' : cur ? 'Compose again' : 'Compose scene'}</button>
          </div>
          <div className="examples">{EXAMPLES.map((x) => <button key={x} className="chip" disabled={!!busy} onClick={() => setRequest(x)}>{x}</button>)}</div>
        </section>
        <TracePanel title="Process 1 · compose" items={trace.p1 ?? []} />
        <TracePanel title="Process 2 · last command" items={trace.p2 ?? []} />
        <TracePanel title="Process 3 · learn" items={trace.p3 ?? []} />
      </aside>

      <main>
        {error && <div className="error" onClick={() => setError(null)}>{error} <span className="muted">(click to dismiss)</span></div>}
        {!cur ? (
          <div className="empty">{busy === 'p1' ? <p className="spin">Composing your scene… the pipeline trace on the left shows each step.</p> : <p>Describe a scene and press <b>Compose scene</b>. The plan appears here; then select objects and speak to edit them.</p>}</div>
        ) : (
          <>
            <div className="sceneHead">
              <h2>{cur.scene.title}</h2>
              <div className="row">
                <span className="muted">{selection.objectIds.length ? `${selection.objectIds.length} selected${selection.region ? ' (region)' : ''}` : 'click, shift-click or drag to select'}</span>
                <button onClick={undo} disabled={!!busy || !cur.history.length}>Undo</button>
                <label className="muted"><input type="checkbox" checked={cur.view.showGrid} onChange={(e) => setCur({ ...cur, view: { ...cur.view, showGrid: e.target.checked } })} /> grid</label>
              </div>
            </div>
            <SceneCanvas scene={cur.scene} layout={cur.layout} view={cur.view} selection={selection} onSelect={setSelection} busy={!!busy} />
            <VoiceInput onCommand={command} disabled={!!busy} hasSelection={selection.objectIds.length > 0} />
            {busy === 'p2' && <div className="status spin">Interpreting “{lastCommand}”…</div>}
            {cur.view.editLog.length > 0 && (
              <details className="log"><summary>Edit log ({cur.view.editLog.length})</summary>
                <ol>{cur.view.editLog.map((e, i) => <li key={i}>“{e.utterance}” → {e.ops.length} op(s)</li>)}</ol>
              </details>
            )}
            <div className="learnBar">
              <button className="primary" onClick={learn} disabled={!!busy}>{busy === 'p3' ? 'Learning…' : 'Learn from this scene'}</button>
              <span className="muted">Finds reusable arrangements in the plan, adds them to the library, reviews them and updates asset reliability.</span>
            </div>
            {lastLearn && <div className="learnResult">
              {lastLearn.added.length ? `Added ${lastLearn.added.length} arrangement(s): ` : 'No new arrangements: no coherent groups of adjacent objects, or they are already in the library.'}
              {lastLearn.judgements.map((j) => <span key={j.assetId} className={`verdict ${j.verdict}`} title={j.reason}>{lib?.library.assets.find((a) => a.id === j.assetId)?.name ?? j.assetId}: {j.verdict}</span>)}
            </div>}
          </>
        )}
      </main>

      <aside className="right">{lib && <LibraryPanel library={lib.library} reliability={lib.reliability} highlight={lastLearn?.added ?? []} />}</aside>
    </div>
  );
}
