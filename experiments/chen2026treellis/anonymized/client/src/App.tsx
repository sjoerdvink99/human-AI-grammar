import { useEffect, useMemo, useRef, useState } from 'react';
import { findNode, formatErrors, parseProgram, type ParamRecord, type SceneNode } from '../../shared/dsl';
import { renderSvg } from '../../shared/render';
import { extractSnippet, setAttribute, setParam, spliceSnippet } from '../../shared/edit';
import * as api from './api';
import { StartScreen } from './components/StartScreen';
import { TreeView } from './components/TreeView';
import { CanvasView } from './components/CanvasView';
import { Inspector } from './components/Inspector';
import { ScopedEdit } from './components/ScopedEdit';
import { ParamsTable } from './components/ParamsTable';
import { CodeView } from './components/CodeView';

const STORE = 'system-x:r3-history';

interface Busy {
  label: string;
  started: number;
  ctl: AbortController;
}

/** r12: the element pinned as the target of a scoped AI edit. */
export interface SnippetTarget {
  nodeId: string;
  startLine: number;
  endLine: number;
}

export function App() {
  // r3 versions: every change appends; the last entry is the current program.
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; }
  });
  const r3 = history[history.length - 1] ?? '';
  const [r1, setR1] = useState(''); // initial description
  const [r16, setR16] = useState(''); // whole-drawing instruction
  const [r7, setR7] = useState<string | null>(null); // selected element id
  const [r10, setR10] = useState<string | null>(null); // selected parameter name
  const [r12, setR12] = useState<SnippetTarget | null>(null);
  const [r13, setR13] = useState('');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerate, setLastGenerate] = useState<{ instruction: string; base?: string } | null>(null);

  useEffect(() => { localStorage.setItem(STORE, JSON.stringify(history.slice(-50))); }, [history]);

  // tool translate: r3 → r4 (tree) + r6 (params) + r5 (svg)
  const translated = useMemo(() => (r3 ? parseProgram(r3) : null), [r3]);
  const program = translated?.ok ? translated.program : null;
  const r5 = useMemo(() => (program ? renderSvg(program) : ''), [program]);

  // keep selections only while they still refer to something
  useEffect(() => {
    if (!program) return;
    if (r7 && !findNode(program.nodes, r7)) setR7(null);
    if (r10 && !program.params.some((p) => p.name === r10)) setR10(null);
  }, [program, r7, r10]);

  const commit = (code: string) => setHistory((h) => [...h, code]);

  /** Validate a deterministic edit before committing it as a new r3 version. */
  const commitToolEdit = (code: string): string | null => {
    const p = parseProgram(code);
    if (!p.ok) return formatErrors(p.errors);
    commit(code);
    return null;
  };

  async function runModel<T>(label: string, fn: (s: AbortSignal) => Promise<T>): Promise<T | null> {
    const ctl = new AbortController();
    setBusy({ label, started: Date.now(), ctl });
    setError(null);
    try {
      return await fn(ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  // Process 1 (r1 → r3_1) and process 6 (r16 + r3_1 → r3_2)
  async function generate(instruction: string, base: string | undefined, label: string) {
    const res = await runModel(label, (s) => api.generate(instruction, base, s));
    if (!res) return false;
    setLastGenerate({ instruction, base });
    commit(res.code);
    return true;
  }

  // Process 5: extract r14_1, model modifies → r14_2, splice → r3_2
  async function runScopedEdit() {
    if (!r12 || !r13.trim()) return;
    const r14 = extractSnippet(r3, r12.startLine, r12.endLine); // tool extract
    const base = r3;
    const res = await runModel(`Editing ${r12.nodeId}…`, (s) =>
      api.modifySnippet(
        { instruction: r13, snippet: r14, code: base,
          selection: { node_id: r12.nodeId, start_line: r12.startLine, end_line: r12.endLine } },
        s,
      ),
    );
    if (!res) return;
    const next = spliceSnippet(base, r12.startLine, r12.endLine, res.snippet); // tool modify
    const err = commitToolEdit(next);
    if (err) return setError(err);
    setR12(null);
    setR13('');
  }

  if (!r3) {
    return (
      <StartScreen
        value={r1}
        onChange={setR1}
        busy={busy}
        error={error}
        onCancel={() => busy?.ctl.abort()}
        onSubmit={() => generate(r1.trim(), undefined, 'Drawing…')}
      />
    );
  }

  const selectedNode: SceneNode | undefined = program && r7 ? findNode(program.nodes, r7) : undefined;
  const selectedParam: ParamRecord | undefined = program?.params.find((p) => p.name === r10);
  const locked = !!busy;
  const highlightLines: [number, number] | null = r12
    ? [r12.startLine, r12.endLine]
    : selectedNode ? [selectedNode.startLine, selectedNode.endLine] : selectedParam ? [selectedParam.line, selectedParam.line] : null;

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">System X</strong>
        <form
          className="global-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!r16.trim()) return;
            if (await generate(r16.trim(), r3, 'Updating the whole drawing…')) setR16('');
          }}
        >
          <input
            value={r16}
            onChange={(e) => setR16(e.target.value)}
            placeholder="Change the whole drawing, e.g. “make it night time and add stars”"
            disabled={locked}
          />
          <button type="submit" disabled={locked || !r16.trim()}>Apply</button>
        </form>
        {lastGenerate && (
          <button
            className="ghost"
            disabled={locked}
            title="Run the last generation request again for a different result"
            onClick={() => generate(lastGenerate.instruction, lastGenerate.base, 'Regenerating…')}
          >
            ↻ Regenerate
          </button>
        )}
        <span className="versions" title="Every edit creates a new version of the program">v{history.length}</span>
        <button
          className="ghost"
          disabled={locked}
          onClick={() => {
            if (!confirm('Start a new drawing? The current program will be discarded.')) return;
            setHistory([]); setR7(null); setR10(null); setR12(null); setLastGenerate(null);
          }}
        >
          New drawing
        </button>
      </header>

      {busy && <BusyBar busy={busy} />}
      {error && (
        <div className="error-bar">
          <pre>{error}</pre>
          <button className="ghost" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <aside className="left">
        <section>
          <h2>Scene</h2>
          {program && <TreeView nodes={program.nodes} selected={r7} onSelect={setR7} />}
        </section>
        <section>
          <h2>Parameters</h2>
          {program && (
            <ParamsTable
              params={program.params}
              selected={r10}
              disabled={locked}
              onSelect={setR10}
              onSpecify={(param, raw) => commitToolEdit(setParam(r3, param, raw))}
            />
          )}
        </section>
      </aside>

      <main className="center">
        {program ? (
          <CanvasView svg={r5} selected={r7} target={r12?.nodeId ?? null} onSelect={setR7} />
        ) : (
          <div className="parse-errors">
            <h3>The program has errors</h3>
            <pre>{translated && !translated.ok ? formatErrors(translated.errors) : ''}</pre>
          </div>
        )}
      </main>

      <aside className="right">
        {selectedNode ? (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            params={program!.params}
            disabled={locked}
            onSelectParent={() => setR7(selectedNode.id.includes('/') ? selectedNode.id.replace(/\/[^/]+$/, '') : null)}
            onSpecify={(attr, raw) => commitToolEdit(setAttribute(r3, selectedNode, attr, raw))}
            onTargetForAI={() => setR12({ nodeId: selectedNode.id, startLine: selectedNode.startLine, endLine: selectedNode.endLine })}
          />
        ) : (
          <p className="hint">Click a shape on the canvas or in the scene tree to inspect and edit it.</p>
        )}
        {r12 && (
          <ScopedEdit
            target={r12}
            snippet={extractSnippet(r3, r12.startLine, r12.endLine)}
            instruction={r13}
            onInstruction={setR13}
            busy={!!busy}
            onRun={runScopedEdit}
            onClose={() => { setR12(null); setR13(''); }}
          />
        )}
      </aside>

      <section className="bottom">
        <CodeView code={r3} highlight={highlightLines} />
      </section>
    </div>
  );
}

function BusyBar({ busy }: { busy: Busy }) {
  const [now, setNow] = useState(Date.now());
  const t = useRef<number | undefined>(undefined);
  useEffect(() => {
    t.current = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t.current);
  }, []);
  return (
    <div className="busy-bar">
      <span className="spinner" /> {busy.label} <span className="muted">{Math.round((now - busy.started) / 1000)}s</span>
      <button className="ghost" onClick={() => busy.ctl.abort()}>Cancel</button>
    </div>
  );
}
