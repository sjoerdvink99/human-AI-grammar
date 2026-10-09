// Process 1 — the author uploads reference texts (source_documents*), which are
// extracted (model_1) and composed into the knowledge graph (tool_1).
import { useState } from "react";
import { api } from "./api.ts";
import type { GraphStats, IngestJob } from "../../shared/types.ts";

interface Props {
  stats: GraphStats | null;
  onClose(): void;
  onUpdated(): void;
}

export function SourcesDialog({ stats, onClose, onUpdated }: Props) {
  const [files, setFiles] = useState<{ title: string; text: string }[]>([]);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [job, setJob] = useState<IngestJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all([...list].map(async (f) => ({ title: f.name.replace(/\.(txt|md|markdown)$/i, ""), text: await f.text() })));
    setFiles((prev) => [...prev, ...read.filter((r) => r.text.trim())]);
  };

  const start = async () => {
    setError(null);
    const all = [...files];
    if (pasteText.trim()) all.push({ title: pasteTitle.trim() || "Pasted source", text: pasteText });
    if (!all.length) return;
    try {
      let j = await api.ingest(all);
      setJob(j);
      while (j.status === "running") {
        await new Promise((r) => setTimeout(r, 1500));
        j = await api.job(j.id);
        setJob(j);
        onUpdated();
      }
      setFiles([]); setPasteText(""); setPasteTitle("");
      onUpdated();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  const running = job?.status === "running";
  return (
    <div className="modal-back" onClick={running ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header><h2>Domain sources</h2><button className="icon" onClick={onClose}>×</button></header>
        <p className="muted small">
          Upload reference books or other domain texts (.txt / .md). Entities and relationships are extracted and linked to their source passages.
        </p>
        {stats && (
          <div className="stats">
            <b>{stats.documents.length}</b> documents · <b>{stats.passageCount}</b> passages · <b>{stats.entityCount}</b> entities · <b>{stats.relationCount}</b> relations
            <ul>{stats.documents.map((d) => <li key={d.id}>{d.title} <span className="muted">({Math.round(d.charCount / 1000)}k chars)</span></li>)}</ul>
          </div>
        )}
        <label className="file">
          <input type="file" multiple accept=".txt,.md,.markdown,text/plain" onChange={(e) => pick(e.target.files)} disabled={running} />
        </label>
        {files.length > 0 && <ul className="small">{files.map((f, i) => <li key={i}>{f.title} ({f.text.length} chars)</li>)}</ul>}
        <details>
          <summary>…or paste text</summary>
          <input placeholder="Title" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} />
          <textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a reference text" />
        </details>
        {job && (
          <div className="progress">
            <div className="bar"><div style={{ width: `${job.total ? (100 * job.done) / job.total : 0}%` }} /></div>
            <span className="small">{job.message} — {job.done}/{job.total} passages</span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <footer>
          <button
            className="danger"
            disabled={running}
            onClick={async () => { if (confirm("Delete the whole knowledge graph?")) { await api.clearGraph(); onUpdated(); } }}
          >Clear graph</button>
          <button className="primary" disabled={running || (!files.length && !pasteText.trim())} onClick={start}>
            {running ? "Building graph…" : "Build knowledge graph"}
          </button>
        </footer>
      </div>
    </div>
  );
}
