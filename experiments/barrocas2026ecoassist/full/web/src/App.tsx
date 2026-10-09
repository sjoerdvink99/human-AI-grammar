import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { html as htmlLang } from "@codemirror/lang-html";
import { css as cssLang } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { FILE_KEYS, FILE_NAMES, type FileKey, type OptimizeResponse, type WebCode } from "../../shared/types.ts";
import { applySelected } from "../../shared/diff.ts";
import { optimize } from "./api.ts";
import { GeneratePanel } from "./components/GeneratePanel.tsx";
import { OptimizerPanel } from "./components/OptimizerPanel.tsx";
import { ReviewPanel } from "./components/ReviewPanel.tsx";
import { PreviewPanel } from "./components/PreviewPanel.tsx";
import { BLANK, EXAMPLE } from "./examples.ts";

interface Version {
  label: string;
  code: WebCode;
  at: string;
}

const LANGS = { html: [htmlLang()], css: [cssLang()], js: [javascript()] };
const STORE = "system-x-session";

function loadSession(): { code: WebCode; history: Version[] } {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "");
    if (s?.code?.html !== undefined) return s;
  } catch {
    /* fresh session */
  }
  return { code: BLANK, history: [] };
}

export function App() {
  const initial = loadSession();
  // `code`: the working artifact in the IDE (code_1 before optimization, code_3 after applying)
  const [code, setCode] = useState<WebCode>(initial.code);
  const [history, setHistory] = useState<Version[]>(initial.history);
  const [file, setFile] = useState<FileKey>("html");
  const [tab, setTab] = useState<"review" | "preview">("preview");
  const [stages, setStages] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // selected_edits_1
  const [previewLabel, setPreviewLabel] = useState("editor code");

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify({ code, history: history.slice(-30) }));
  }, [code, history]);

  function commit(next: WebCode, label: string) {
    setHistory((h) => [...h, { label, code: next, at: new Date().toLocaleTimeString() }]);
    setCode(next);
  }

  async function runOptimize() {
    setOptimizing(true);
    setError(null);
    setResult(null);
    setStages([]);
    setTab("review");
    try {
      await optimize(code, (e) => {
        if (e.stage === "result") {
          setResult(e.result);
          setSelected(new Set(e.result.diff.hunks.map((h) => h.id)));
        } else if (e.stage === "error") setError(e.error);
        else if (e.stage === "baseline-done") setStages((s) => [...s, `Original: ${e.energyBefore.joules.toFixed(2)} J`]);
        else setStages((s) => [...s, e.message]);
      });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setOptimizing(false);
    }
  }

  // [tool_5 modify]: code_1 + diff_1 + selected_edits_1 → code_3
  function applyEdits() {
    if (!result) return;
    const code3 = applySelected(result.code1, result.code2, selected);
    commit(code3, `Optimized (${selected.size}/${result.diff.hunks.length} changes)`);
    setResult(null);
    setPreviewLabel("optimized code (code_3)");
    setTab("preview"); // process 4 follows process 3
  }

  const dirtySinceOptimize = result && JSON.stringify(result.code1) !== JSON.stringify(code);

  return (
    <div className="app">
      <header className="topbar">
        <b>System X</b> <span className="muted">energy-aware frontend IDE</span>
        <span className="spacer" />
        <select
          value=""
          onChange={(e) => {
            const v = history[Number(e.target.value)];
            if (v) commit(v.code, `Restored: ${v.label}`);
          }}
        >
          <option value="">History ({history.length})</option>
          {history.map((v, i) => (
            <option key={i} value={i}>
              {v.at} — {v.label}
            </option>
          ))}
        </select>
        <button onClick={() => commit(EXAMPLE, "Example page")}>Load example</button>
      </header>

      <aside className="left">
        <GeneratePanel hasCode={code.html !== BLANK.html} onGenerated={(c, label) => { commit(c, label); setPreviewLabel("generated code (code_1)"); setTab("preview"); }} />
        <OptimizerPanel />
      </aside>

      <main className="center">
        <div className="tabs">
          {FILE_KEYS.map((k) => (
            <button key={k} className={k === file ? "tab on" : "tab"} onClick={() => setFile(k)}>
              {FILE_NAMES[k]}
            </button>
          ))}
          <span className="spacer" />
          <button className="primary" disabled={optimizing} onClick={runOptimize}>
            {optimizing ? <span className="spinner">Optimizing…</span> : "⚡ Optimize for energy"}
          </button>
        </div>
        <div className="editor">
          <CodeMirror value={code[file]} height="100%" extensions={LANGS[file]} onChange={(v) => setCode((c) => ({ ...c, [file]: v }))} />
        </div>
      </main>

      <section className="right">
        <div className="tabs">
          <button className={tab === "review" ? "tab on" : "tab"} onClick={() => setTab("review")}>
            Energy review {result && `(${result.diff.hunks.length})`}
          </button>
          <button className={tab === "preview" ? "tab on" : "tab"} onClick={() => { setTab("preview"); setPreviewLabel("editor code"); }}>
            Preview
          </button>
        </div>
        {tab === "review" ? (
          <div className="pane">
            {optimizing && (
              <ol className="stages">
                {stages.map((s, i) => (
                  <li key={i} className={i === stages.length - 1 ? "active" : "done"}>
                    {s}
                  </li>
                ))}
              </ol>
            )}
            {error && <div className="error">{error} <button onClick={runOptimize}>Retry</button></div>}
            {dirtySinceOptimize && <div className="warn small">The editor changed since this optimization ran; applying uses the code that was optimized.</div>}
            {result ? (
              <ReviewPanel
                result={result}
                selected={selected}
                onToggle={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                onSetAll={(on) => setSelected(new Set(on ? result.diff.hunks.map((h) => h.id) : []))}
                onApply={applyEdits}
                onDiscard={() => setResult(null)}
              />
            ) : (
              !optimizing && !error && <p className="muted">Run “Optimize for energy” to profile the page, get an optimized version, and review the changes.</p>
            )}
          </div>
        ) : (
          <PreviewPanel code={code} label={previewLabel} />
        )}
      </section>
    </div>
  );
}
