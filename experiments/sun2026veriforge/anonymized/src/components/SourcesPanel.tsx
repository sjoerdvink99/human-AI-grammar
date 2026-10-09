import { useState } from "react";
import type { KnowledgeGraph, SourceDocument } from "../shared/types";
import { uid } from "../shared/tools";
import { GraphView } from "./GraphView";

const TYPE_COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#9c755f"];

interface Props {
  sourceDocuments: SourceDocument[];
  setSourceDocuments: (d: SourceDocument[]) => void;
  knowledgeGraph: KnowledgeGraph | null;
  graphStale: boolean;
  busy: boolean;
  onBuild: () => void;
  onLoadSample: () => void;
  highlightNodeIds: Set<string>;
}

/** r1* (source documents) and P1 trigger; r4 knowledge graph view. */
export function SourcesPanel(p: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const add = () => {
    if (!text.trim()) return;
    p.setSourceDocuments([...p.sourceDocuments, { id: uid("doc-"), title: title.trim() || "Untitled", text: text.trim() }]);
    setTitle("");
    setText("");
    setAdding(false);
  };
  const upload = async (files: FileList | null) => {
    if (!files) return;
    const docs = await Promise.all(
      [...files].map(async (f) => ({ id: uid("doc-"), title: f.name.replace(/\.[^.]+$/, ""), text: (await f.text()).trim() })),
    );
    p.setSourceDocuments([...p.sourceDocuments, ...docs.filter((d) => d.text)]);
  };

  const types = [...new Set(p.knowledgeGraph?.nodes.map((n) => n.type) ?? [])];
  const colors = Object.fromEntries(types.map((t, i) => [t, TYPE_COLORS[i % TYPE_COLORS.length]]));

  return (
    <section className="panel sources">
      <header>
        <h2>Sources</h2>
        <span className="muted">{p.sourceDocuments.length} documents</span>
      </header>
      <ul className="doc-list">
        {p.sourceDocuments.map((d) => (
          <li key={d.id}>
            <div className="doc-row">
              <button className="link" onClick={() => setOpen(open === d.id ? null : d.id)}>
                {d.title}
              </button>
              <button className="icon" title="Remove" onClick={() => p.setSourceDocuments(p.sourceDocuments.filter((x) => x.id !== d.id))}>
                ×
              </button>
            </div>
            {open === d.id && <p className="doc-text">{d.text}</p>}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="add-doc">
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder="Paste document text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button onClick={add}>Add</button>
            <button className="ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button className="ghost" onClick={() => setAdding(true)}>
            + Paste
          </button>
          <label className="button ghost">
            Upload .txt/.md
            <input type="file" accept=".txt,.md,text/plain" multiple hidden onChange={(e) => upload(e.target.files)} />
          </label>
          {!p.sourceDocuments.length && (
            <button className="ghost" onClick={p.onLoadSample}>
              Load example
            </button>
          )}
        </div>
      )}
      <button className="primary" disabled={p.busy || !p.sourceDocuments.length} onClick={p.onBuild}>
        {p.busy ? "Extracting entities and relations…" : p.knowledgeGraph ? "Rebuild knowledge graph" : "Build knowledge graph"}
      </button>
      {p.graphStale && p.knowledgeGraph && <p className="warn">Sources changed since the graph was built.</p>}

      {p.knowledgeGraph && (
        <>
          <header>
            <h2>Knowledge graph</h2>
            <span className="muted">
              {p.knowledgeGraph.nodes.length} nodes · {p.knowledgeGraph.edges.length} relations
            </span>
          </header>
          <div className="graph-box">
            <GraphView
              width={300}
              height={300}
              nodes={p.knowledgeGraph.nodes.map((n) => ({ id: n.id, label: n.name, group: n.type, title: `${n.name} (${n.type})\n${n.description}` }))}
              edges={p.knowledgeGraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }))}
              colors={colors}
              highlightIds={p.highlightNodeIds}
            />
          </div>
          <div className="legend">
            {types.map((t) => (
              <span key={t}>
                <i style={{ background: colors[t] }} />
                {t}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
