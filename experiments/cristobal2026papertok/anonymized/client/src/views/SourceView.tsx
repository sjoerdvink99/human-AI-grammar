import { useState } from "react";
import { api, type Project } from "../api.ts";
import type { Act } from "../App.tsx";

/** r1: the source document. */
export default function SourceView({ project, act, next }: { project: Project; act: Act; next: () => void }) {
  const [text, setText] = useState(project.paper);
  const [loadingFile, setLoadingFile] = useState(false);
  const dirty = text.trim() !== project.paper;

  async function onFile(f: File) {
    setLoadingFile(true);
    try {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) setText((await api.pdfToText(f)).text);
      else setText(await f.text());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFile(false);
    }
  }

  return (
    <section>
      <header>
        <h2>Source document</h2>
        <p className="muted">Paste a paper or long article, or load a PDF / text file. Everything downstream is derived from it.</p>
      </header>
      <div className="row">
        <label className="button secondary">
          {loadingFile ? "Reading…" : "Load file…"}
          <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <span className="muted">{text.length.toLocaleString()} characters</span>
      </div>
      <textarea className="paper" value={text} onChange={(e) => setText(e.target.value)} placeholder="Title&#10;Authors&#10;&#10;Abstract …" />
      <div className="row">
        <button
          disabled={!!project.busy || text.trim().length < 200 || (!dirty && !!project.paper)}
          onClick={() => {
            if (project.concepts.length && !confirm("Replacing the document clears the concepts, script and scenes. Continue?")) return;
            act(() => api.setPaper(text)).then(next);
          }}
        >
          Use this document
        </button>
        {!dirty && project.paper && (
          <button className="secondary" onClick={next}>
            Continue →
          </button>
        )}
      </div>
    </section>
  );
}
